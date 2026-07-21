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

/** User with profile, kids and avatar (no subscription include) */
export interface UserWithProfileKidsAvatar extends User {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
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

/** User with the avatar relation only */
export interface UserWithAvatar extends User {
  avatar?: Avatar | null;
}

export interface SafeUser extends Omit<User, 'passwordHash' | 'pinHash'> {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
  subscriptions?: Subscription[];
  numberOfKids?: number;
}

// ==================== GDPR Data Export ====================
// The set of relations a "download all my data" (data-portability) export
// gathers. Kept as a typed constant so `Prisma.UserGetPayload` can derive the
// return type AND so `satisfies Prisma.UserInclude` compile-checks every
// relation name. Deliberately excluded: activityLogs / userIps (internal
// audit/security data, not user-provided) and paymentMethods (gateway tokens).
// Kids' `createdStories` use a light `select` (no heavy images/branches/audio
// caches) so the payload stays bounded.
export const USER_EXPORT_INCLUDE = {
  profile: true,
  avatar: true,
  subscription: true,
  paymentTransactions: true,
  notifications: true,
  notificationPreferences: true,
  parentFavorites: true,
  userStoryProgress: true,
  learningExpectations: true,
  couponRedemptions: true,
  voices: true,
  badges: true,
  supportTickets: true,
  preferredCategories: true,
  kids: {
    include: {
      favorites: true,
      progresses: true,
      rewards: true,
      rewardRedemptions: true,
      downloadedStories: true,
      questionAnswers: true,
      notificationPreferences: true,
      createdStories: {
        select: {
          id: true,
          title: true,
          description: true,
          language: true,
          coverImageUrl: true,
          audioUrl: true,
          textContent: true,
          isInteractive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

export type UserDataExport = Prisma.UserGetPayload<{
  include: typeof USER_EXPORT_INCLUDE;
}>;

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
  /** All of a user's portable data (self + kids) for a GDPR export. */
  findUserForExport(id: string): Promise<UserDataExport | null>;

  // User write operations
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
  updateActiveUserSimple(
    id: string,
    data: Partial<{
      role: string;
      avatarId: string | null;
      pinHash: string;
      onboardingStatus: string;
    }>,
  ): Promise<User>;
  updateUserWithProfileUpsert(
    id: string,
    userData: Prisma.UserUncheckedUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithProfileKidsAvatar>;
  updateParentProfile(
    id: string,
    userData: Prisma.UserUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithProfileAvatarAndCategories>;
  updateUserRole(id: string, role: string): Promise<UserWithAvatar>;
  updateParentAvatar(userId: string, avatarId: string): Promise<UserWithAvatar>;
  deleteUserPermanently(id: string): Promise<User>;
  softDeleteUser(id: string): Promise<User>;
  restoreUser(id: string): Promise<UserWithProfileKidsAvatar>;

  // Avatar operations
  createAvatar(data: {
    url: string;
    name: string;
    isSystemAvatar: boolean;
  }): Promise<Avatar>;
  createAndAssignAvatar(
    userId: string,
    url: string,
    publicId: string,
  ): Promise<UserWithAvatar>;

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
