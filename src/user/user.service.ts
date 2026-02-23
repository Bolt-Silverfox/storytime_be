import { Injectable } from '@nestjs/common';
import {
  ResourceNotFoundException,
  InvalidRoleException,
} from '@/shared/exceptions';
import {
  Prisma,
  User,
  Profile,
  Kid,
  Avatar,
  Subscription,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UserRole } from './user.controller';
import { UpdateUserDto } from './dto/user.dto';
import { UpdateParentProfileDto } from './dto/update-parent-profile.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';

/** User with relations but sensitive fields excluded */
export type SafeUser = Omit<User, 'passwordHash' | 'pinHash'> & {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
  subscriptions?: Subscription[];
  numberOfKids?: number;
};

/**
 * Select object that excludes sensitive fields (passwordHash, pinHash) at the database level.
 * This prevents sensitive data from ever being fetched, rather than relying on TypeScript types.
 */
const safeUserSelect = {
  id: true,
  email: true,
  name: true,
  avatarId: true,
  isEmailVerified: true,
  onboardingStatus: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  biometricsEnabled: true,
  isSuspended: true,
  suspendedAt: true,
  isDeleted: true,
  deletedAt: true,
  preferredVoiceId: true,
  googleId: true,
  appleId: true,
  // Explicitly exclude: passwordHash, pinHash
} satisfies Prisma.UserSelect;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUser(id: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
      select: {
        ...safeUserSelect,
        profile: true,
        kids: true,
        avatar: true,
        subscription: true,
      },
    });
    if (!user) return null;

    return { ...user, numberOfKids: user.kids.length };
  }

  /**
   * Get user including deleted ones (for checking account status)
   */
  async getUserIncludingDeleted(id: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...safeUserSelect,
        profile: true,
        kids: true,
        avatar: true,
        subscription: true,
      },
    });

    if (user) {
      return { ...user, numberOfKids: user.kids.length };
    }
    return null;
  }

  /**
   * Get all users (admin only) - includes both active and soft deleted users
   */
  async getAllUsers(): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({
      select: {
        ...safeUserSelect,
        profile: true,
        avatar: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }

  /**
   * Get only active users (non-admin)
   */
  async getActiveUsers(): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isDeleted: false,
      },
      select: {
        ...safeUserSelect,
        profile: true,
        avatar: true,
      },
    });

    return users;
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!user) throw new ResourceNotFoundException('User', id);

    const updateData: Prisma.UserUncheckedUpdateInput = {};

    const profileUpdate: Prisma.ProfileUpdateInput = {};

    // -------- USER FIELDS --------
    if (data.name !== undefined) updateData.name = data.name;
    if (data.biometricsEnabled !== undefined)
      updateData.biometricsEnabled = data.biometricsEnabled;

    // -------- PROFILE FIELDS --------
    if (data.language !== undefined) profileUpdate.language = data.language;
    if (data.country !== undefined) profileUpdate.country = data.country;

    // Avatar logic - handled inside transaction if custom URL provided
    const needsCustomAvatar =
      data.avatarId === undefined && data.avatarUrl !== undefined;
    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    }

    // If nothing to update, return existing
    if (
      Object.keys(updateData).length === 0 &&
      Object.keys(profileUpdate).length === 0 &&
      !needsCustomAvatar
    ) {
      return this.getUser(id);
    }

    // Use transaction to ensure avatar creation + user update are atomic
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      // Create custom avatar if URL provided (inside transaction)
      if (needsCustomAvatar) {
        const newAvatar = await tx.avatar.create({
          data: {
            url: data.avatarUrl!,
            name: `Custom Avatar for ${id}`,
            isSystemAvatar: false,
          },
        });
        updateData.avatarId = newAvatar.id;
      }

      return tx.user.update({
        where: { id },
        data: {
          ...updateData,
          ...(Object.keys(profileUpdate).length > 0 && {
            profile: {
              upsert: {
                create: profileUpdate,
                update: profileUpdate,
              },
            },
          }),
        } as Prisma.UserUpdateInput,
        include: { profile: true, kids: true, avatar: true },
      });
    });

    return {
      ...updatedUser,
      numberOfKids: updatedUser.kids?.length ?? 0,
    };
  }

  async getUserRole(id: string) {
    const u = await this.prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
    });
    return { id: u?.id, role: u?.role };
  }

  async updateUserRole(id: string, role: UserRole) {
    if (!Object.values(UserRole).includes(role)) {
      throw new InvalidRoleException(role);
    }

    const user = await this.prisma.user.update({
      where: {
        id,
        isDeleted: false,
      },
      data: { role },
      include: { avatar: true },
    });

    return { id: user.id, role: user.role };
  }

  // ----------------------------------------------------------
  // PARENT PROFILE
  // ----------------------------------------------------------

  async updateParentProfile(userId: string, data: UpdateParentProfileDto) {
    const existing = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!existing) throw new ResourceNotFoundException('User', userId);

    const updateUser: Prisma.UserUpdateInput = {};

    const updateProfile: Prisma.ProfileUpdateInput = {};

    if (data.name !== undefined) updateUser.name = data.name;
    if (data.biometricsEnabled !== undefined)
      updateUser.biometricsEnabled = data.biometricsEnabled;
    if (data.language !== undefined) updateProfile.language = data.language;
    if (data.country !== undefined) updateProfile.country = data.country;

    // Handle preferred categories if provided
    if (data.preferredCategories) {
      updateUser.preferredCategories = {
        set: data.preferredCategories.map((id: string) => ({ id })),
      };
    }

    // Use transaction for learning expectations (deleteMany + create must be atomic)
    // to prevent data loss if create fails after deleteMany succeeds
    if (data.learningExpectationIds) {
      return this.prisma.$transaction(async (tx) => {
        // First delete existing learning expectations
        await tx.userLearningExpectation.deleteMany({
          where: { userId },
        });

        // Then update user with new learning expectations
        return tx.user.update({
          where: { id: userId },
          data: {
            ...updateUser,
            learningExpectations: {
              create: data.learningExpectationIds!.map((id: string) => ({
                learningExpectationId: id,
              })),
            },
            ...(Object.keys(updateProfile).length > 0 && {
              profile: {
                upsert: {
                  create: updateProfile,
                  update: updateProfile,
                },
              },
            }),
          } as Prisma.UserUpdateInput,
          include: { profile: true, avatar: true, preferredCategories: true },
        });
      });
    }

    // No learning expectations update - simple update without transaction
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...updateUser,
        ...(Object.keys(updateProfile).length > 0 && {
          profile: {
            upsert: {
              create: updateProfile,
              update: updateProfile,
            },
          },
        }),
      } as Prisma.UserUpdateInput,
      include: { profile: true, avatar: true, preferredCategories: true },
    });
  }

  async updateAvatarForParent(userId: string, body: UpdateAvatarDto) {
    return this.prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: { avatarId: body.avatarId },
      include: { avatar: true },
    });
  }
}
