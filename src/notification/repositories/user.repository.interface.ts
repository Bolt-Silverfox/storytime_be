import type { Prisma } from '@prisma/client';

// Minimal projection of a user needed to compose notification emails.
export type UserContact = Prisma.UserGetPayload<{
  select: { email: true; name: true };
}>;

// ==================== Repository Interface ====================
export interface IUserRepository {
  // Find a user's email + name by id (used to compose notification emails)
  findContactById(userId: string): Promise<UserContact | null>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
