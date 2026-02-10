import { Injectable } from '@nestjs/common';
import {
  Prisma,
  User,
  Avatar,
  Token,
  ActivityLog,
  SupportTicket,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  IUserRepository,
  UserWithRelations,
  UserWithProfileAndAvatar,
  UserWithProfileAvatarAndCategories,
} from './user.repository.interface';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== User Read Operations ====================

  async findUserById(id: string, includeDeleted = false): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: includeDeleted ? { id } : { id, isDeleted: false },
    });
  }

  async findUserByIdWithRelations(
    id: string,
    includeDeleted = false,
  ): Promise<UserWithRelations | null> {
    return this.prisma.user.findUnique({
      where: includeDeleted ? { id } : { id, isDeleted: false },
      include: {
        profile: true,
        kids: true,
        avatar: true,
        subscriptions: true,
      },
    });
  }

  async findAllUsers(): Promise<UserWithProfileAndAvatar[]> {
    return this.prisma.user.findMany({
      include: {
        profile: true,
        avatar: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveUsers(): Promise<UserWithProfileAndAvatar[]> {
    return this.prisma.user.findMany({
      where: { isDeleted: false },
      include: {
        profile: true,
        avatar: true,
      },
    });
  }

  // ==================== User Write Operations ====================

  async updateUser(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<UserWithRelations> {
    return this.prisma.user.update({
      where: { id },
      data,
      include: {
        profile: true,
        kids: true,
        avatar: true,
        subscriptions: true,
      },
    });
  }

  async updateUserSimple(
    id: string,
    data: Partial<{
      role: string;
      avatarId: string | null;
      isDeleted: boolean;
      deletedAt: Date | null;
      pinHash: string;
      onboardingStatus: string;
    }>,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: data as Prisma.UserUpdateInput,
    });
  }

  async updateUserWithProfileUpsert(
    id: string,
    userData: Prisma.UserUncheckedUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithRelations> {
    const hasProfileData = Object.keys(profileData).length > 0;

    return this.prisma.user.update({
      where: { id },
      data: {
        ...userData,
        ...(hasProfileData && {
          profile: {
            upsert: {
              create: profileData,
              update: profileData,
            },
          },
        }),
      } as Prisma.UserUpdateInput,
      include: {
        profile: true,
        kids: true,
        avatar: true,
        subscriptions: true,
      },
    });
  }

  async updateParentProfile(
    id: string,
    userData: Prisma.UserUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithProfileAvatarAndCategories> {
    const hasProfileData = Object.keys(profileData).length > 0;

    return this.prisma.user.update({
      where: { id },
      data: {
        ...userData,
        ...(hasProfileData && {
          profile: {
            upsert: {
              create: profileData,
              update: profileData,
            },
          },
        }),
      } as Prisma.UserUpdateInput,
      include: {
        profile: true,
        avatar: true,
        preferredCategories: true,
      },
    });
  }

  async deleteUserPermanently(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }

  async softDeleteUser(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async restoreUser(id: string): Promise<UserWithRelations> {
    return this.prisma.user.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      include: {
        profile: true,
        kids: true,
        avatar: true,
        subscriptions: true,
      },
    });
  }

  // ==================== Avatar Operations ====================

  async createAvatar(data: {
    url: string;
    name: string;
    isSystemAvatar: boolean;
  }): Promise<Avatar> {
    return this.prisma.avatar.create({ data });
  }

  async updateUserAvatar(
    userId: string,
    avatarId: string,
  ): Promise<UserWithProfileAndAvatar> {
    return this.prisma.user.update({
      where: { id: userId, isDeleted: false },
      data: { avatarId },
      include: { profile: true, avatar: true },
    });
  }

  // ==================== Session Operations ====================

  async deleteAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  // ==================== Token Operations ====================

  async deleteAllUserTokens(userId: string): Promise<void> {
    await this.prisma.token.deleteMany({ where: { userId } });
  }

  async createToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
    type: string;
  }): Promise<Token> {
    return this.prisma.token.create({ data });
  }

  async findTokenByHashedToken(
    userId: string,
    hashedToken: string,
    type: string,
  ): Promise<Token | null> {
    return this.prisma.token.findFirst({
      where: {
        userId,
        token: hashedToken,
        type,
      },
    });
  }

  async deleteToken(id: string): Promise<void> {
    await this.prisma.token.delete({ where: { id } });
  }

  async deleteTokensByUserAndType(userId: string, type: string): Promise<void> {
    await this.prisma.token.deleteMany({
      where: { userId, type },
    });
  }

  // ==================== Activity Log Operations ====================

  async createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog> {
    return this.prisma.activityLog.create({
      data: {
        ...data,
        createdAt: new Date(),
      },
    });
  }

  // ==================== Support Ticket Operations ====================

  async createSupportTicket(data: {
    userId: string;
    subject: string;
    message: string;
  }): Promise<SupportTicket> {
    return this.prisma.supportTicket.create({ data });
  }
}
