import type {
  User,
  Profile,
  Avatar,
  Session,
  Token,
  LearningExpectation,
} from '@prisma/client';
import { TokenType } from '../dto/auth.dto';

// ==================== User Types ====================
export interface UserWithProfileAndAvatar extends User {
  profile: Profile | null;
  avatar: Avatar | null;
}

export interface UserWithProfileAvatarAndKidCount
  extends UserWithProfileAndAvatar {
  _count: { kids: number };
}

export interface UserWithLearningExpectations extends User {
  profile: Profile | null;
  avatar: Avatar | null;
  learningExpectations: Array<{
    learningExpectation: LearningExpectation;
  }>;
}

// ==================== Session Types ====================
export interface SessionWithUser extends Session {
  user: User & { _count: { kids: number } };
}

// ==================== Token Types ====================
export interface TokenWithUser extends Token {
  user: User;
}

// ==================== Repository Interface ====================
export interface IAuthRepository {
  // User operations
  findUserByEmail(email: string): Promise<User | null>;
  findUserByEmailWithRelations(
    email: string,
  ): Promise<UserWithProfileAvatarAndKidCount | null>;
  findUserById(id: string): Promise<User | null>;
  findUserByIdWithProfile(id: string): Promise<UserWithProfileAndAvatar | null>;
  findUserByIdWithLearningExpectations(
    id: string,
  ): Promise<UserWithLearningExpectations | null>;
  findUserByGoogleId(
    googleId: string,
  ): Promise<UserWithProfileAndAvatar | null>;
  findUserByAppleId(appleId: string): Promise<UserWithProfileAndAvatar | null>;
  createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
    role: string;
    onboardingStatus?: string;
    googleId?: string | null;
    appleId?: string | null;
    isEmailVerified?: boolean;
    profile?: { create: { country: string } };
  }): Promise<UserWithProfileAndAvatar>;
  updateUser(
    id: string,
    data: Partial<{
      passwordHash: string;
      isEmailVerified: boolean;
      onboardingStatus: string;
      googleId: string | null;
      appleId: string | null;
      avatarId: string | null;
    }>,
  ): Promise<User>;
  updateUserWithRelations(
    id: string,
    data: Partial<{
      passwordHash: string;
      isEmailVerified: boolean;
      onboardingStatus: string;
      googleId: string | null;
      appleId: string | null;
      avatarId: string | null;
    }>,
  ): Promise<UserWithProfileAndAvatar>;
  updateUserPreferredCategories(
    userId: string,
    categoryIds: string[],
  ): Promise<void>;
  countKidsByParentId(parentId: string): Promise<number>;

  // Session operations
  createSession(data: {
    userId: string;
    token: string;
    expiresAt: Date;
  }): Promise<Session>;
  findSessionByToken(hashedToken: string): Promise<SessionWithUser | null>;
  findSessionById(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  deleteAllUserSessions(userId: string): Promise<void>;
  deleteOtherSessions(userId: string, exceptSessionId: string): Promise<void>;

  // Token operations
  createToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
    type: TokenType;
  }): Promise<Token>;
  findTokenByHashedToken(
    hashedToken: string,
    type: TokenType,
  ): Promise<TokenWithUser | null>;
  deleteToken(id: string): Promise<void>;
  deleteUserTokensByType(userId: string, type: TokenType): Promise<void>;

  // Profile operations
  updateProfile(
    userId: string,
    data: Partial<{
      language: string;
      languageCode: string;
      country: string;
      explicitContent: boolean;
      maxScreenTimeMins: number;
    }>,
  ): Promise<Profile>;
  upsertProfile(
    userId: string,
    updateData: Record<string, unknown>,
    createData: {
      country: string;
      language?: string;
      languageCode?: string;
    },
  ): Promise<Profile>;
  createProfile(userId: string, data: { country: string }): Promise<Profile>;

  // Avatar operations
  findAvatarByUrl(url: string): Promise<Avatar | null>;
  createAvatar(data: {
    url: string;
    name: string;
    isSystemAvatar: boolean;
  }): Promise<Avatar>;

  // Learning Expectation operations
  findActiveLearningExpectations(): Promise<LearningExpectation[]>;
  findLearningExpectationsByIds(ids: string[]): Promise<LearningExpectation[]>;
  createUserLearningExpectations(
    userId: string,
    learningExpectationIds: string[],
  ): Promise<void>;

  // Transaction support
  transaction<T>(
    fn: (tx: IAuthRepositoryTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface IAuthRepositoryTransaction {
  updateUser(id: string, data: { passwordHash: string }): Promise<User>;
  deleteOtherSessions(userId: string, exceptSessionId: string): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
