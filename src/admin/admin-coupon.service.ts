import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import { CouponService } from '../coupon/coupon.service';
import {
  IAdminCouponRepository,
  ADMIN_COUPON_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminCouponService {
  constructor(
    @Inject(ADMIN_COUPON_REPOSITORY)
    private readonly couponRepo: IAdminCouponRepository,
    private readonly couponService: CouponService,
  ) {}

  async createCoupon(dto: CreateCouponDto) {
    const normalizedCode = dto.code.toUpperCase();
    const existing = await this.couponRepo.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictException(
        `Coupon code "${normalizedCode}" already exists`,
      );
    }

    return this.couponRepo.create({
      code: normalizedCode,
      type: dto.type,
      value: dto.value,
      maxUses: dto.maxUses ?? null,
      validFrom: new Date(dto.validFrom),
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      plan: dto.plan ?? null,
    });
  }

  async listCoupons(page: number, limit: number, isActive?: boolean) {
    const skip = (page - 1) * limit;
    const where: Prisma.CouponWhereInput = {};
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [coupons, total] = await Promise.all([
      this.couponRepo.findManyPaginated({
        where,
        skip,
        take: limit,
      }),
      this.couponRepo.count(where),
    ]);

    return {
      data: coupons,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCouponById(id: string) {
    const coupon = await this.couponRepo.findByIdWithRedemptions(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return coupon;
  }

  async updateCoupon(id: string, dto: UpdateCouponDto) {
    const coupon = await this.couponRepo.findById(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const data: Prisma.CouponUpdateInput = {};
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.validUntil !== undefined)
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.plan !== undefined) data.plan = dto.plan;
    if (dto.value !== undefined) data.value = dto.value;

    return this.couponRepo.update(id, data);
  }

  async deleteCoupon(id: string) {
    const coupon = await this.couponRepo.findById(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return this.couponRepo.update(id, { isActive: false });
  }

  async validateCoupon(code: string, plan?: string) {
    const coupon = await this.couponRepo.findByCode(code.toUpperCase());

    if (!coupon) {
      return { valid: false, reason: 'Coupon not found' };
    }
    if (!coupon.isActive) {
      return { valid: false, reason: 'Coupon is inactive' };
    }

    const now = new Date();
    if (now < coupon.validFrom) {
      return { valid: false, reason: 'Coupon is not yet valid' };
    }
    if (coupon.validUntil && now > coupon.validUntil) {
      return { valid: false, reason: 'Coupon has expired' };
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, reason: 'Coupon usage limit reached' };
    }
    if (coupon.plan && plan && coupon.plan !== plan) {
      return {
        valid: false,
        reason: `Coupon is only valid for the ${coupon.plan} plan`,
      };
    }

    return {
      valid: true,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        plan: coupon.plan,
      },
    };
  }

  async redeemCoupon(code: string, userId: string) {
    // Delegate to CouponService so premiumAccessUntil is set atomically,
    // race-safe usedCount increment is applied, and all validation is shared.
    return this.couponService.redeemCoupon(userId, code);
  }
}
