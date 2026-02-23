import type { Prisma, User } from '@prisma/client';

// ==================== Repository Interface ====================

// Type for User with all relations for list view
export type UserWithRelations = User & {
  subscription: {
    id: string;
    plan: string;
    status: string;
    endsAt: Date | null;
  } | null;
  profile: any;
  avatar: any;
  usage: {
    elevenLabsCount: number;
  } | null;
  kids: Array<{
    screenTimeSessions: Array<{
      duration: number | null;
    }>;
  }>;
  paymentTransactions: Array<{
    amount: number;
  }>;
  _count: {
    kids: number;
    auth: number;
    parentFavorites: number;
    paymentTransactions: number;
  };
};

// Type for User detail view
export type UserDetail = User & {
  profile: any;
  kids: Array<{
    id: string;
    name: string;
    ageRange: string;
    createdAt: Date;
    avatar: any;
  }>;
  avatar: any;
  subscription: any | null;
  paymentTransactions: any[];
  _count: {
    auth: number;
    parentFavorites: number;
    voices: number;
    supportTickets: number;
    paymentTransactions: number;
  };
};

export interface IAdminUserRepository {
  // Find users with pagination and filtering
  findUsers(params: {
    where: Prisma.UserWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }): Promise<UserWithRelations[]>;

  // Count users matching criteria
  countUsers(where: Prisma.UserWhereInput): Promise<number>;

  // Find user by ID with all relations
  findUserById(userId: string): Promise<UserDetail | null>;

  // Aggregate payment transactions
  aggregatePaymentTransactions(params: {
    userId: string;
    status: string;
  }): Promise<{ _sum: { amount: number | null } }>;

  // Check if user exists with email
  userExistsByEmail(email: string): Promise<boolean>;

  // Find user by email
  findUserByEmail(email: string): Promise<User | null>;

  // Create new user (admin)
  createUser(data: {
    email: string;
    passwordHash: string;
    name: string;
    role: string;
    isEmailVerified: boolean;
    profile: { country: string };
  }): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: Date;
  }>;

  // Find user by ID (simple)
  findUserByIdSimple(userId: string): Promise<User | null>;

  // Update user
  updateUser(params: {
    userId: string;
    data: Prisma.UserUpdateInput;
  }): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isEmailVerified: boolean;
    updatedAt: Date;
  }>;

  // Soft delete user
  softDeleteUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }>;

  // Hard delete user
  hardDeleteUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }>;

  // Restore user
  restoreUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }>;

  // Bulk soft delete users
  bulkSoftDeleteUsers(userIds: string[]): Promise<{ count: number }>;

  // Bulk restore users
  bulkRestoreUsers(userIds: string[]): Promise<{ count: number }>;

  // Bulk verify users
  bulkVerifyUsers(userIds: string[]): Promise<{ count: number }>;
}

export const ADMIN_USER_REPOSITORY = Symbol('ADMIN_USER_REPOSITORY');
