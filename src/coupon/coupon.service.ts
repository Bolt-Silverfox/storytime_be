import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CouponType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

const FREE_TRIAL_DAYS_PER_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a coupon code for the requesting user.
   * Checks validity and whether the user has already redeemed it.
   */
  async validateCoupon(
    userId: string,
    code: string,
  ): Promise<{ valid: boolean; freeDays?: number; message: string }> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!coupon) {
      return { valid: false, message: 'Invalid coupon code' };
    }
    if (!coupon.isActive) {
      return { valid: false, message: 'This coupon is no longer active' };
    }

    const now = new Date();
    if (now < coupon.validFrom) {
      return { valid: false, message: 'This coupon is not yet valid' };
    }
    if (coupon.validUntil && now > coupon.validUntil) {
      return { valid: false, message: 'This coupon has expired' };
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, message: 'This coupon has reached its usage limit' };
    }
    if (coupon.type !== CouponType.FREE_TRIAL_DAYS) {
      return { valid: false, message: 'This coupon type cannot be redeemed here' };
    }

    // Check if this user already redeemed this coupon
    const existingRedemption = await this.prisma.couponRedemption.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (existingRedemption) {
      return { valid: false, message: 'You have already redeemed this coupon' };
    }

    const freeDays = Math.floor(coupon.value);
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
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!coupon) throw new NotFoundException('Invalid coupon code');
    if (!coupon.isActive) throw new BadRequestException('This coupon is no longer active');

    const now = new Date();
    if (now < coupon.validFrom) {
      throw new BadRequestException('This coupon is not yet valid');
    }
    if (coupon.validUntil && now > coupon.validUntil) {
      throw new BadRequestException('This coupon has expired');
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }
    if (coupon.type !== CouponType.FREE_TRIAL_DAYS) {
      throw new BadRequestException('This coupon type cannot be redeemed here');
    }

    // Check for duplicate redemption
    const existingRedemption = await this.prisma.couponRedemption.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (existingRedemption) {
      throw new ConflictException('You have already redeemed this coupon');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      select: { premiumAccessUntil: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const freeDays = Math.floor(coupon.value);
    const freeDaysMs = freeDays * FREE_TRIAL_DAYS_PER_DAY_MS;

    // Extend existing premium access or start from now — whichever is later
    const baseDate =
      user.premiumAccessUntil && user.premiumAccessUntil > now
        ? user.premiumAccessUntil
        : now;
    const premiumAccessUntil = new Date(baseDate.getTime() + freeDaysMs);

    // Atomically create redemption, update user, increment coupon usedCount
    await this.prisma.$transaction([
      this.prisma.couponRedemption.create({
        data: { couponId: coupon.id, userId },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { premiumAccessUntil },
      }),
      this.prisma.coupon.update({
        where: { id: coupon.id },
        data: { usedCount: { increment: 1 } },
      }),
    ]);

    this.logger.log(
      `User ${userId} redeemed coupon ${coupon.code} (+${freeDays} days, until ${premiumAccessUntil.toISOString()})`,
    );

    return {
      success: true,
      premiumAccessUntil,
      freeDays,
      message: `You have ${freeDays} day${freeDays === 1 ? '' : 's'} of free premium access! Enjoy until ${premiumAccessUntil.toLocaleDateString()}.`,
    };
  }
}
