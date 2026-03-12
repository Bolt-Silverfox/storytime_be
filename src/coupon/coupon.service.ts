import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { type Coupon, CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared: load a coupon by code and validate all business rules.
   * Returns the coupon or throws/returns an invalid result.
   * When `throwOnError` is true, throws NestJS HTTP exceptions.
   * When false, returns `{ valid: false, message }` for soft validation responses.
   */
  private async assertCouponRedeemable(
    code: string,
    userId: string,
    throwOnError: true,
  ): Promise<Coupon>;
  private async assertCouponRedeemable(
    code: string,
    userId: string,
    throwOnError: false,
  ): Promise<
    | { valid: false; message: string }
    | {
        valid: true;
        coupon: Awaited<
          ReturnType<typeof this.prisma.coupon.findUniqueOrThrow>
        >;
      }
  >;
  private async assertCouponRedeemable(
    code: string,
    userId: string,
    throwOnError: boolean,
  ): Promise<unknown> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    const fail = (message: string) => {
      if (throwOnError) throw new BadRequestException(message);
      return { valid: false as const, message };
    };

    if (!coupon) {
      if (throwOnError) throw new NotFoundException('Invalid coupon code');
      return { valid: false as const, message: 'Invalid coupon code' };
    }
    if (!coupon.isActive) return fail('This coupon is no longer active');

    const now = new Date();
    if (now < coupon.validFrom) return fail('This coupon is not yet valid');
    if (coupon.validUntil && now > coupon.validUntil)
      return fail('This coupon has expired');
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return fail('This coupon has reached its usage limit');
    }
    if (coupon.type !== CouponType.FREE_TRIAL_DAYS) {
      return fail('This coupon type cannot be redeemed here');
    }

    const existingRedemption = await this.prisma.couponRedemption.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (existingRedemption) {
      if (throwOnError)
        throw new ConflictException('You have already redeemed this coupon');
      return {
        valid: false as const,
        message: 'You have already redeemed this coupon',
      };
    }

    if (throwOnError) return coupon;
    return { valid: true as const, coupon };
  }

  /**
   * Validate a coupon code for the requesting user.
   * Checks validity and whether the user has already redeemed it.
   */
  async validateCoupon(
    userId: string,
    code: string,
  ): Promise<{ valid: boolean; freeDays?: number; message: string }> {
    const result = await this.assertCouponRedeemable(code, userId, false);
    if (!result.valid) return result;

    const freeDays = Math.floor(result.coupon.value);
    if (freeDays <= 0)
      return { valid: false, message: 'This coupon has no valid free days' };
    return {
      valid: true,
      freeDays,
      message: `This coupon gives you ${freeDays} day${freeDays === 1 ? '' : 's'} of free premium access!`,
    };
  }

  /**
   * Redeem a coupon for the authenticated user.
   * Grants FREE_TRIAL_DAYS premium access atomically.
   */
  async redeemCoupon(
    userId: string,
    code: string,
  ): Promise<{
    success: boolean;
    premiumAccessUntil: Date;
    freeDays: number;
    message: string;
  }> {
    const coupon = await this.assertCouponRedeemable(code, userId, true);

    const freeDays = Math.floor(coupon.value);
    if (freeDays <= 0)
      throw new BadRequestException('This coupon has no valid free days');
    const freeDaysMs = freeDays * MS_PER_DAY;

    // Declared outside so the post-transaction log/return can access it.
    let premiumAccessUntil!: Date;

    // Atomically create redemption, update user, and increment usedCount.
    // Uses interactive transaction so we can guard against concurrent maxUses races:
    // two requests that both pass the pre-check above could otherwise both succeed.
    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-validate coupon constraints inside the transaction to close the
        // TOCTOU gap: between assertCouponRedeemable and now, the coupon could
        // have been deactivated, expired, or had its type changed.
        const now = new Date();
        const couponGuard = {
          id: coupon.id,
          isActive: true,
          type: CouponType.FREE_TRIAL_DAYS,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        };

        if (coupon.maxUses !== null) {
          const updated = await tx.coupon.updateMany({
            where: { ...couponGuard, usedCount: { lt: coupon.maxUses } },
            data: { usedCount: { increment: 1 } },
          });
          if (updated.count === 0) {
            throw new BadRequestException(
              'Coupon is no longer valid or has reached its usage limit',
            );
          }
        } else {
          const updated = await tx.coupon.updateMany({
            where: couponGuard,
            data: { usedCount: { increment: 1 } },
          });
          if (updated.count === 0) {
            throw new BadRequestException('Coupon is no longer valid');
          }
        }

        await tx.couponRedemption.create({
          data: { couponId: coupon.id, userId },
        });

        // CAS-style update to prevent lost premium extensions under concurrent redemptions.
        // Read premiumAccessUntil inside the transaction and pass it as the expected value
        // in updateMany. PostgreSQL re-evaluates the WHERE clause on committed data at
        // UPDATE time, so a concurrent commit causes count=0 (optimistic lock failure).
        const currentUser = await tx.user.findUnique({
          where: { id: userId, isDeleted: false },
          select: { premiumAccessUntil: true },
        });
        if (!currentUser) throw new NotFoundException('User not found');

        const baseDate =
          currentUser.premiumAccessUntil && currentUser.premiumAccessUntil > now
            ? currentUser.premiumAccessUntil
            : now;
        const candidate = new Date(baseDate.getTime() + freeDaysMs);

        const casResult = await tx.user.updateMany({
          where: {
            id: userId,
            isDeleted: false,
            premiumAccessUntil: currentUser.premiumAccessUntil,
          },
          data: { premiumAccessUntil: candidate },
        });

        if (casResult.count === 0) {
          throw new ConflictException(
            'Concurrent premium update detected. Please retry.',
          );
        }

        premiumAccessUntil = candidate;
      });
    } catch (err) {
      // Rethrow intentional HTTP exceptions (BadRequest, Conflict, NotFound)
      // without logging them as unexpected errors
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // P2002 unique constraint = same user redeemed concurrently; map to 409
        if (err.code === 'P2002') {
          throw new ConflictException('You have already redeemed this coupon');
        }
        // P2025 record not found = user or coupon deleted between pre-check and transaction
        if (err.code === 'P2025') {
          this.logger.warn(
            `P2025 during redemption: coupon ${coupon.code} or user ${userId} no longer exists`,
          );
          throw new NotFoundException('Coupon or account no longer available');
        }
      }
      this.logger.error(
        `Unexpected error redeeming coupon ${coupon.code} for user ${userId}: ${(err as Error).message}`,
      );
      throw err;
    }

    this.logger.log(
      `User ${userId} redeemed coupon ${coupon.code} (+${freeDays} days, until ${premiumAccessUntil.toISOString()})`,
    );

    return {
      success: true,
      premiumAccessUntil,
      freeDays,
      message: `You have ${freeDays} day${freeDays === 1 ? '' : 's'} of free premium access! Premium expires on ${premiumAccessUntil.toISOString().slice(0, 10)}.`,
    };
  }
}
