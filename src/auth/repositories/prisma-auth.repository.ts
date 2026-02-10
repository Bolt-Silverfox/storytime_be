import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  User,
  Profile,
  Avatar,
  Session,
  Token,
  LearningExpectation,
} from '@prisma/client';
import { TokenType } from '../dto/auth.dto';
import {
  IAuthRepository,
  IAuthRepositoryTransaction,
  UserWithProfileAndAvatar,
  UserWithProfileAvatarAndKidCount,
  UserWithLearningExpectations,
  SessionWithUser,
  TokenWithUser,
} from './auth.repository.interface';

@Injectable()
export class PrismaAuthRepository implements IAuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== User Operations ====================

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUserByEmailWithRelations(
    email: string,
  ): Promise<UserWithProfileAvatarAndKidCount | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        avatar: true,
        _count: { select: { kids: true } },
      },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findUserByIdWithProfile(
    id: string,
  ): Promise<UserWithProfileAndAvatar | null> {
    return this.prisma.user.findFirst({
      where: { id },
      include: { profile: true, avatar: true },
    });
  }

  async findUserByIdWithLearningExpectations(
    id: string,
  ): Promise<UserWithLearningExpectations | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        avatar: true,
        learningExpectations: {
          include: {
            learningExpectation: true,
          },
        },
      },
    });
  }

  async findUserByGoogleId(
    googleId: string,
  ): Promise<UserWithProfileAndAvatar | null> {
    return this.prisma.user.findFirst({
      where: { googleId },
      include: { profile: true, avatar: true },
    });
  }

  async findUserByAppleId(
    appleId: string,
  ): Promise<UserWithProfileAndAvatar | null> {
    return this.prisma.user.findFirst({
      where: { appleId },
      include: { profile: true, avatar: true },
    });
  }

  async createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
    role: string;
    onboardingStatus?: string;
    googleId?: string | null;
    appleId?: string | null;
    isEmailVerified?: boolean;
    profile?: { create: { country: string } };
  }): Promise<UserWithProfileAndAvatar> {
    return this.prisma.user.create({
      data: data as Parameters<typeof this.prisma.user.create>[0]['data'],
      include: { profile: true, avatar: true },
    });
  }

  async updateUser(
    id: string,
    data: Partial<{
      passwordHash: string;
      isEmailVerified: boolean;
      onboardingStatus: string;
      googleId: string | null;
      appleId: string | null;
      avatarId: string | null;
    }>,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: data as Parameters<typeof this.prisma.user.update>[0]['data'],
    });
  }

  async updateUserWithRelations(
    id: string,
    data: Partial<{
      passwordHash: string;
      isEmailVerified: boolean;
      onboardingStatus: string;
      googleId: string | null;
      appleId: string | null;
      avatarId: string | null;
    }>,
  ): Promise<UserWithProfileAndAvatar> {
    return this.prisma.user.update({
      where: { id },
      data: data as Parameters<typeof this.prisma.user.update>[0]['data'],
      include: { profile: true, avatar: true },
    }) as Promise<UserWithProfileAndAvatar>;
  }

  async updateUserPreferredCategories(
    userId: string,
    categoryIds: string[],
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferredCategories: {
          set: categoryIds.map((id) => ({ id })),
        },
      },
    });
  }

  async countKidsByParentId(parentId: string): Promise<number> {
    return this.prisma.kid.count({ where: { parentId } });
  }

  // ==================== Session Operations ====================

  async createSession(data: {
    userId: string;
    token: string;
    expiresAt: Date;
  }): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  async findSessionByToken(
    hashedToken: string,
  ): Promise<SessionWithUser | null> {
    return this.prisma.session.findUnique({
      where: { token: hashedToken },
      include: {
        user: {
          include: {
            _count: { select: { kids: true } },
          },
        },
      },
    });
  }

  async findSessionById(id: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id } });
  }

  async deleteSession(id: string): Promise<void> {
    await this.prisma.session.delete({ where: { id } });
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  async deleteOtherSessions(
    userId: string,
    exceptSessionId: string,
  ): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        userId,
        id: { not: exceptSessionId },
      },
    });
  }

  // ==================== Token Operations ====================

  async createToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
    type: TokenType;
  }): Promise<Token> {
    return this.prisma.token.create({ data });
  }

  async findTokenByHashedToken(
    hashedToken: string,
    type: TokenType,
  ): Promise<TokenWithUser | null> {
    return this.prisma.token.findUnique({
      where: { token: hashedToken, type },
      include: { user: true },
    });
  }

  async deleteToken(id: string): Promise<void> {
    await this.prisma.token.delete({ where: { id } });
  }

  async deleteUserTokensByType(userId: string, type: TokenType): Promise<void> {
    await this.prisma.token.deleteMany({
      where: { userId, type },
    });
  }

  // ==================== Profile Operations ====================

  async updateProfile(
    userId: string,
    data: Partial<{
      language: string;
      languageCode: string;
      country: string;
      explicitContent: boolean;
      maxScreenTimeMins: number;
    }>,
  ): Promise<Profile> {
    return this.prisma.profile.update({
      where: { userId },
      data,
    });
  }

  async upsertProfile(
    userId: string,
    updateData: Record<string, unknown>,
    createData: {
      country: string;
      language?: string;
      languageCode?: string;
    },
  ): Promise<Profile> {
    return this.prisma.profile.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...createData,
        ...updateData,
      },
    });
  }

  async createProfile(
    userId: string,
    data: { country: string },
  ): Promise<Profile> {
    return this.prisma.profile.create({
      data: { userId, ...data },
    });
  }

  // ==================== Avatar Operations ====================

  async findAvatarByUrl(url: string): Promise<Avatar | null> {
    return this.prisma.avatar.findFirst({ where: { url } });
  }

  async createAvatar(data: {
    url: string;
    name: string;
    isSystemAvatar: boolean;
  }): Promise<Avatar> {
    return this.prisma.avatar.create({ data });
  }

  // ==================== Learning Expectation Operations ====================

  async findActiveLearningExpectations(): Promise<LearningExpectation[]> {
    return this.prisma.learningExpectation.findMany({
      where: {
        isActive: true,
        isDeleted: false,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findLearningExpectationsByIds(
    ids: string[],
  ): Promise<LearningExpectation[]> {
    return this.prisma.learningExpectation.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        isDeleted: false,
      },
    });
  }

  async createUserLearningExpectations(
    userId: string,
    learningExpectationIds: string[],
  ): Promise<void> {
    await this.prisma.userLearningExpectation.createMany({
      data: learningExpectationIds.map((id) => ({
        userId,
        learningExpectationId: id,
      })),
      skipDuplicates: true,
    });
  }

  // ==================== Transaction Support ====================

  async transaction<T>(
    fn: (tx: IAuthRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (prisma) => {
      const tx: IAuthRepositoryTransaction = {
        updateUser: async (id, data) => {
          return prisma.user.update({ where: { id }, data });
        },
        deleteOtherSessions: async (userId, exceptSessionId) => {
          await prisma.session.deleteMany({
            where: {
              userId,
              id: { not: exceptSessionId },
            },
          });
        },
      };
      return fn(tx);
    });
  }
}
