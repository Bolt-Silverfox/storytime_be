import type {
  User,
  Profile,
  Kid,
  Avatar,
  Subscription,
  Token,
  ActivityLog,
  SupportTicket,
  Prisma,
} from '@prisma/client';

// ==================== User Types ====================
export interface UserWithRelations extends User {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
  subscriptions?: Subscription[];
}

export interface UserWithProfileAndAvatar extends User {
  profile?: Profile | null;
  avatar?: Avatar | null;
}

export interface UserWithProfileAvatarAndCategories extends User {
  profile?: Profile | null;
  avatar?: Avatar | null;
  preferredCategories?: { id: string }[];
}

export interface SafeUser extends Omit<User, 'passwordHash' | 'pinHash'> {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
  subscriptions?: Subscription[];
  numberOfKids?: number;
}

// ==================== Repository Interface ====================
export interface IUserRepository {
  // User read operations
  findUserById(id: string, includeDeleted?: boolean): Promise<User | null>;
  findUserByIdWithRelations(
    id: string,
    includeDeleted?: boolean,
  ): Promise<UserWithRelations | null>;
  findAllUsers(): Promise<UserWithProfileAndAvatar[]>;
  findActiveUsers(): Promise<UserWithProfileAndAvatar[]>;

  // User write operations
  updateUser(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<UserWithRelations>;
  updateUserSimple(
    id: string,
    data: Partial<{
      role: string;
      avatarId: string | null;
      isDeleted: boolean;
      deletedAt: Date | null;
      pinHash: string;
      onboardingStatus: string;
    }>,
  ): Promise<User>;
  updateUserWithProfileUpsert(
    id: string,
    userData: Prisma.UserUncheckedUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithRelations>;
  updateParentProfile(
    id: string,
    userData: Prisma.UserUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithProfileAvatarAndCategories>;
  deleteUserPermanently(id: string): Promise<User>;
  softDeleteUser(id: string): Promise<User>;
  restoreUser(id: string): Promise<UserWithRelations>;

  // Avatar operations
  createAvatar(data: {
    url: string;
    name: string;
    isSystemAvatar: boolean;
  }): Promise<Avatar>;
  updateUserAvatar(
    userId: string,
    avatarId: string,
  ): Promise<UserWithProfileAndAvatar>;

  // Session operations
  deleteAllUserSessions(userId: string): Promise<void>;

  // Token operations
  deleteAllUserTokens(userId: string): Promise<void>;
  createToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
    type: string;
  }): Promise<Token>;
  findTokenByHashedToken(
    userId: string,
    hashedToken: string,
    type: string,
  ): Promise<Token | null>;
  deleteToken(id: string): Promise<void>;
  deleteTokensByUserAndType(userId: string, type: string): Promise<void>;

  // Activity log operations
  createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog>;

  // Support ticket operations
  createSupportTicket(data: {
    userId: string;
    subject: string;
    message: string;
  }): Promise<SupportTicket>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
