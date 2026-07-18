import type { Prisma, User, UserUsage } from '@prisma/client';

// ==================== Payload Types ====================

// Shape returned by the paginated user list query (getAllUsers)
export type AdminUserListItem = Prisma.UserGetPayload<{
  include: {
    subscription: {
      select: {
        id: true;
        plan: true;
        status: true;
        endsAt: true;
      };
    };
    profile: true;
    avatar: true;
    usage: {
      select: { elevenLabsCount: true };
    };
    kids: {
      select: {
        screenTimeSessions: {
          select: { duration: true };
        };
      };
    };
    paymentTransactions: {
      select: { amount: true; currency: true };
    };
    _count: {
      select: {
        kids: true;
        auth: true;
        parentFavorites: true;
        paymentTransactions: true;
      };
    };
  };
}>;

// Shape returned by the single-user detail query (getUserById)
export type AdminUserDetail = Prisma.UserGetPayload<{
  include: {
    profile: true;
    kids: {
      select: {
        id: true;
        name: true;
        ageRange: true;
        createdAt: true;
        avatar: true;
      };
    };
    avatar: true;
    subscription: true;
    usage: true;
    paymentTransactions: true;
    _count: {
      select: {
        auth: true;
        parentFavorites: true;
        voices: true;
        supportTickets: true;
        paymentTransactions: true;
      };
    };
  };
}>;

// Shape returned by the getUserGrowth query
export type AdminUserGrowthRow = Prisma.UserGetPayload<{
  include: { subscription: true };
}>;

// Shape returned by the getUserGrowthMonthly query
export type AdminUserGrowthMonthlyRow = Prisma.UserGetPayload<{
  select: { createdAt: true; id: true; subscription: true };
}>;

export interface IAdminUserRepository {
  // Generic count with arbitrary where — covers dashboard/analytics user counts
  count(where: Prisma.UserWhereInput): Promise<number>;

  // getUserGrowth: users in range with their subscription
  findManyWithSubscription(params: {
    where: Prisma.UserWhereInput;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }): Promise<AdminUserGrowthRow[]>;

  // getUserGrowthMonthly: users since a start date (subset of fields)
  findManyForGrowthMonthly(
    startDate: Date,
  ): Promise<AdminUserGrowthMonthlyRow[]>;

  // getAllUsers: paginated users with detail includes
  findManyWithDetails(params: {
    where: Prisma.UserWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }): Promise<AdminUserListItem[]>;

  // getUserById: single user with detail includes
  findByIdWithDetails(userId: string): Promise<AdminUserDetail | null>;

  // Lookups
  findById(userId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findActiveById(userId: string): Promise<User | null>;

  // Mutations
  createAdmin(data: {
    email: string;
    passwordHash: string;
    name: string;
  }): Promise<Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>>;

  updateUserFields(
    userId: string,
    data: Prisma.UserUpdateInput,
  ): Promise<
    Pick<
      User,
      'id' | 'email' | 'name' | 'role' | 'isEmailVerified' | 'updatedAt'
    >
  >;

  hardDeleteUser(userId: string): Promise<User>;
  softDeleteUser(userId: string): Promise<User>;
  restoreUser(userId: string): Promise<User>;

  suspendUser(
    userId: string,
  ): Promise<
    Pick<
      User,
      | 'id'
      | 'email'
      | 'name'
      | 'role'
      | 'isSuspended'
      | 'suspendedAt'
      | 'updatedAt'
    >
  >;
  unsuspendUser(
    userId: string,
  ): Promise<
    Pick<
      User,
      | 'id'
      | 'email'
      | 'name'
      | 'role'
      | 'isSuspended'
      | 'suspendedAt'
      | 'updatedAt'
    >
  >;

  bulkSoftDelete(userIds: string[]): Promise<{ count: number }>;
  bulkRestore(userIds: string[]): Promise<{ count: number }>;
  bulkVerify(userIds: string[]): Promise<{ count: number }>;

  // User usage (quota)
  findUserUsage(userId: string): Promise<UserUsage | null>;
  updateUserUsage(
    userId: string,
    data: Prisma.UserUsageUpdateInput,
  ): Promise<UserUsage>;
}

export const ADMIN_USER_REPOSITORY = Symbol('ADMIN_USER_REPOSITORY');
