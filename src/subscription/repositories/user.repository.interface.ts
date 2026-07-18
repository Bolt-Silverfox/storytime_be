import type { Prisma } from '@prisma/client';

// Shape returned when loading a user for the premium-access check
export type UserPremiumCheck = Prisma.UserGetPayload<{
  select: {
    role: true;
    premiumAccessUntil: true;
    subscription: { select: { status: true; endsAt: true } };
  };
}>;

// ==================== Repository Interface ====================
export interface IUserRepository {
  // Find a user with the fields needed to evaluate premium access
  findByIdWithSubscriptionStatus(
    userId: string,
  ): Promise<UserPremiumCheck | null>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
