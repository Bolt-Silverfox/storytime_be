import type { UserBadge, Prisma } from '@prisma/client';

// ==================== Types ====================
export type UserBadgeWithBadge = Prisma.UserBadgeGetPayload<{
  include: { badge: true };
}>;

export interface UserBadgeCompositeKey {
  userId: string;
  kidId: string | null;
  badgeId: string;
}

// ==================== Repository Interface ====================
export interface IUserBadgeRepository {
  // Create parent-level and per-kid userBadge records within a single transaction
  createUserBadgesInTransaction(
    data: Prisma.UserBadgeUncheckedCreateInput[],
  ): Promise<UserBadge[]>;

  // Find preview badges (unlocked first, then priority, then creation date)
  findPreviewBadges(
    where: Prisma.UserBadgeWhereInput,
    take: number,
  ): Promise<UserBadgeWithBadge[]>;

  // Find remaining locked preview badges (ordered by priority only)
  findRemainingPreviewBadges(
    where: Prisma.UserBadgeWhereInput,
    take: number,
  ): Promise<UserBadgeWithBadge[]>;

  // Find the full badge list for a user (ordered by priority)
  findFullBadgeList(
    where: Prisma.UserBadgeWhereInput,
  ): Promise<UserBadgeWithBadge[]>;

  // Find a single user badge by its composite key, with the badge included
  findByCompositeKey(
    userId: string,
    kidId: string | null,
    badgeId: string,
  ): Promise<UserBadgeWithBadge | null>;

  // Find a single user badge by its composite key (no include, optionally within a transaction)
  findByCompositeKeyForUpdate(
    key: UserBadgeCompositeKey,
    tx?: Prisma.TransactionClient,
  ): Promise<UserBadge | null>;

  // Update a user badge by id (optionally within a transaction)
  updateById(
    id: string,
    data: Prisma.UserBadgeUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<UserBadge>;

  // Execute an interactive transaction
  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

export const USER_BADGE_REPOSITORY = Symbol('USER_BADGE_REPOSITORY');
