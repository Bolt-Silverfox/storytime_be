import type { CouponRedemption, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface ICouponRedemptionRepository {
  // Find a redemption by the unique (couponId, userId) pair
  findUniqueByCouponAndUser(
    couponId: string,
    userId: string,
  ): Promise<CouponRedemption | null>;

  // Create a redemption (optionally within a transaction)
  create(
    data: Prisma.CouponRedemptionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<CouponRedemption>;
}

export const COUPON_REDEMPTION_REPOSITORY = Symbol(
  'COUPON_REDEMPTION_REPOSITORY',
);
