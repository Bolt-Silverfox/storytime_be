import type { Coupon, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface ICouponRepository {
  // Find a coupon by its unique code
  findUniqueByCode(code: string): Promise<Coupon | null>;

  // Increment usedCount by 1 for coupons matching the given guard where clause
  // (optionally within a transaction). Returns the affected row count.
  incrementUsedCount(
    where: Prisma.CouponWhereInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }>;

  // Execute a transaction
  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

export const COUPON_REPOSITORY = Symbol('COUPON_REPOSITORY');
