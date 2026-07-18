import type { Prisma, Coupon } from '@prisma/client';

export type CouponWithRedemptionCount = Prisma.CouponGetPayload<{
  include: { _count: { select: { redemptions: true } } };
}>;

export type CouponWithRedemptions = Prisma.CouponGetPayload<{
  include: {
    redemptions: {
      include: {
        user: { select: { id: true; name: true; email: true } };
      };
    };
  };
}>;

export interface IAdminCouponRepository {
  findByCode(code: string): Promise<Coupon | null>;
  findById(id: string): Promise<Coupon | null>;
  findByIdWithRedemptions(id: string): Promise<CouponWithRedemptions | null>;

  create(data: Prisma.CouponCreateInput): Promise<Coupon>;
  update(id: string, data: Prisma.CouponUpdateInput): Promise<Coupon>;

  count(where: Prisma.CouponWhereInput): Promise<number>;
  findManyPaginated(params: {
    where: Prisma.CouponWhereInput;
    skip: number;
    take: number;
  }): Promise<CouponWithRedemptionCount[]>;
}

export const ADMIN_COUPON_REPOSITORY = Symbol('ADMIN_COUPON_REPOSITORY');
