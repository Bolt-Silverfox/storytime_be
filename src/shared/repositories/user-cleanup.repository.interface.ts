import type { Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
// DB access for GDPR cleanup when a user is deleted.
export interface IUserCleanupRepository {
  // Soft-delete all of a user's active sessions.
  softDeleteUserSessions(userId: string): Promise<Prisma.BatchPayload>;

  // Cancel all of a user's active subscriptions.
  cancelActiveUserSubscriptions(userId: string): Promise<Prisma.BatchPayload>;
}

export const USER_CLEANUP_REPOSITORY = Symbol('USER_CLEANUP_REPOSITORY');
