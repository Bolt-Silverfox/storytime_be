import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Prisma,
  User,
  Avatar,
  Token,
  ActivityLog,
  SupportTicket,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { retireAvatarIfUnreferenced } from '@/avatar/retire-avatar';
import {
  IUserRepository,
  UserWithRelations,
  UserWithProfileKidsAvatar,
  UserWithProfileAndAvatar,
  UserWithProfileAvatarAndCategories,
  UserWithAvatar,
  UserDataExport,
  USER_EXPORT_INCLUDE,
  PinResetTokenIssue,
  PinResetTokenRedemption,
} from './user.repository.interface';

const PIN_RESET_TOKEN_TYPE = 'pin_reset';

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
        subscription: true,
      },
    });
  }

  async findUserForExport(id: string): Promise<UserDataExport | null> {
    return this.prisma.user.findUnique({
      where: { id, isDeleted: false },
      include: USER_EXPORT_INCLUDE,
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

  async updateActiveUserSimple(
    id: string,
    data: Partial<{
      role: string;
      avatarId: string | null;
      pinHash: string;
      onboardingStatus: string;
      hasRatedApp: boolean;
      rateAppDismissedAt: Date | null;
    }>,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id, isDeleted: false },
      data: data as Prisma.UserUpdateInput,
    });
  }

  async updateUserWithProfileUpsert(
    id: string,
    userData: Prisma.UserUncheckedUpdateInput,
    profileData: Prisma.ProfileUpdateInput,
  ): Promise<UserWithProfileKidsAvatar> {
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
      include: { profile: true, kids: true, avatar: true },
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
      include: { profile: true, avatar: true, preferredCategories: true },
    });
  }

  async updateUserRole(id: string, role: string): Promise<UserWithAvatar> {
    return this.prisma.user.update({
      where: { id, isDeleted: false },
      data: { role } as Prisma.UserUpdateInput,
      include: { avatar: true },
    });
  }

  async updateParentAvatar(
    userId: string,
    avatarId: string,
  ): Promise<UserWithAvatar> {
    return this.prisma.user.update({
      where: { id: userId, isDeleted: false },
      data: { avatarId },
      include: { avatar: true },
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

  async restoreUser(id: string): Promise<UserWithProfileKidsAvatar> {
    return this.prisma.user.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      include: { profile: true, kids: true, avatar: true },
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

  async createAndAssignAvatar(
    userId: string,
    url: string,
    publicId: string,
  ): Promise<{ user: UserWithAvatar; retiredPublicId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId, isDeleted: false },
        select: { avatarId: true },
      });

      if (!user) {
        throw new NotFoundException(`User ${userId} not found or deleted`);
      }

      const avatar = await tx.avatar.create({
        data: {
          url,
          publicId,
          name: `user_avatar_${userId}_${randomUUID()}`,
          isSystemAvatar: false,
        },
      });

      const updated = await tx.user.update({
        where: { id: userId, isDeleted: false },
        data: { avatarId: avatar.id },
        include: { avatar: true },
      });

      const retiredPublicId = user.avatarId
        ? await retireAvatarIfUnreferenced(tx, user.avatarId)
        : null;

      return { user: updated, retiredPublicId };
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

  async issuePinResetToken(input: {
    userId: string;
    hashedToken: string;
    expiresAt: Date;
    maxFailedAttempts: number;
  }): Promise<PinResetTokenIssue> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
      const existing = await tx.token.findMany({
        where: { userId: input.userId, type: PIN_RESET_TOKEN_TYPE },
      });
      const now = Date.now();
      const failedAttempts = Math.max(
        0,
        ...existing
          .filter((token) => token.expiresAt.getTime() > now)
          .map((token) => token.failedAttempts),
      );
      if (failedAttempts >= input.maxFailedAttempts) {
        return 'guess_budget_spent';
      }

      await tx.token.deleteMany({
        where: { userId: input.userId, type: PIN_RESET_TOKEN_TYPE },
      });
      await tx.token.create({
        data: {
          userId: input.userId,
          token: input.hashedToken,
          expiresAt: input.expiresAt,
          type: PIN_RESET_TOKEN_TYPE,
          failedAttempts,
        },
      });
      return 'issued';
    });
  }

  async redeemPinResetToken(input: {
    userId: string;
    hashedToken: string;
    maxFailedAttempts: number;
    newPinHash?: string;
  }): Promise<PinResetTokenRedemption> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
      const tokens = await tx.token.findMany({
        where: { userId: input.userId, type: PIN_RESET_TOKEN_TYPE },
      });
      const now = Date.now();
      const presented = tokens.find(
        (token) => token.token === input.hashedToken,
      );

      if (!presented) {
        const liveIds = tokens
          .filter((token) => token.expiresAt.getTime() > now)
          .map((token) => token.id);
        if (liveIds.length > 0) {
          await tx.token.updateMany({
            where: { id: { in: liveIds } },
            data: { failedAttempts: { increment: 1 } },
          });
        }
        return 'invalid';
      }
      if (presented.failedAttempts >= input.maxFailedAttempts) {
        return 'invalid';
      }
      if (presented.expiresAt.getTime() <= now) {
        await tx.token.delete({ where: { id: presented.id } });
        return 'expired';
      }
      if (input.newPinHash === undefined) {
        return 'valid';
      }

      await tx.user.update({
        where: { id: input.userId, isDeleted: false },
        data: { pinHash: input.newPinHash },
      });
      await tx.token.delete({ where: { id: presented.id } });
      return 'pin_changed';
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
