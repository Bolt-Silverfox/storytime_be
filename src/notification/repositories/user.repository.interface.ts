import type { Prisma } from '@prisma/client';

// Minimal projection of a user needed to compose notification emails.
export type UserContact = Prisma.UserGetPayload<{
  select: { email: true; name: true };
}>;

// ==================== Repository Interface ====================
export interface IUserRepository {
  // Find a user's email + name by id (used to compose notification emails)
  findContactById(userId: string): Promise<UserContact | null>;

  // Page active (non-deleted, non-suspended) user ids for broadcast fan-out.
  // Cursor pagination ordered by id asc, selecting id only.
  findActiveUsersBatch(params: {
    take: number;
    cursor?: string;
  }): Promise<{ id: string }[]>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
