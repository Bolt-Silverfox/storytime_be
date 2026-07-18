import type { Prisma } from '@prisma/client';

// Shape returned when loading a user's current premium-access expiry
export interface UserPremiumAccess {
  premiumAccessUntil: Date | null;
}

// ==================== Repository Interface ====================
export interface IUserRepository {
  // Load a non-deleted user's current premiumAccessUntil
  // (optionally within a transaction)
  findPremiumAccessById(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserPremiumAccess | null>;

  // CAS-style update of premiumAccessUntil: only applies when the stored
  // value still equals expectedPremiumAccessUntil. Returns affected row count.
  casUpdatePremiumAccess(
    params: {
      userId: string;
      expectedPremiumAccessUntil: Date | null;
      premiumAccessUntil: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
