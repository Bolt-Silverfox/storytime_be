import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, User, Profile, Kid, Avatar, Subscription } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UserRole } from './user.controller';
import { UpdateUserDto } from './dto/user.dto';
import { UpdateParentProfileDto } from './dto/update-parent-profile.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { hashPin, verifyPinHash } from './utils/pin.util';
import { NotificationService } from '@/notification/notification.service';

/** User with relations but sensitive fields excluded */
export type SafeUser = Omit<User, 'passwordHash' | 'pinHash'> & {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
  subscriptions?: Subscription[];
  numberOfKids?: number;
};

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async getUser(id: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
      include: { profile: true, kids: true, avatar: true, subscriptions: true },
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
      include: { profile: true, kids: true, avatar: true, subscriptions: true },
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
      include: {
        profile: true,
        avatar: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, pinHash, ...safeUser } = user;
      return safeUser;
    });
  }

  /**
   * Get only active users (non-admin)
   */
  async getActiveUsers(): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isDeleted: false,
      },
      include: { profile: true, avatar: true },
    });

    return users.map((user) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, pinHash, ...safeUser } = user;
      return safeUser;
    });
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const updateData: Prisma.UserUncheckedUpdateInput = {};

    const profileUpdate: Prisma.ProfileUpdateInput = {};

    // -------- USER FIELDS --------
    if (data.name !== undefined) updateData.name = data.name;
    if (data.biometricsEnabled !== undefined)
      updateData.biometricsEnabled = data.biometricsEnabled;

    // Avatar logic
    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    } else if (data.avatarUrl !== undefined) {
      const newAvatar = await this.prisma.avatar.create({
        data: {
          url: data.avatarUrl,
          name: `Custom Avatar for ${id}`,
          isSystemAvatar: false,
        },
      });
      updateData.avatarId = newAvatar.id;
    }

    // -------- PROFILE FIELDS --------
    if (data.language !== undefined) profileUpdate.language = data.language;
    if (data.country !== undefined) profileUpdate.country = data.country;

    // If nothing to update, return existing
    if (
      Object.keys(updateData).length === 0 &&
      Object.keys(profileUpdate).length === 0
    ) {
      return this.getUser(id);
    }

    const updatedUser = await this.prisma.user.update({
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
      throw new BadRequestException('Invalid role');
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
    if (!existing) throw new NotFoundException('User not found');

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

    // Handle learning expectations if provided (explicit M-N)
    if (data.learningExpectationIds) {
      updateUser.learningExpectations = {
        deleteMany: {},
        create: data.learningExpectationIds.map((id: string) => ({
          learningExpectationId: id,
        })),
      };
    }

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

  async setPin(userId: string, pin: string) {
    if (!/^\d{6}$/.test(pin))
      throw new BadRequestException('PIN must be exactly 6 digits');

    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.onboardingStatus !== 'profile_setup') {
      throw new BadRequestException(
        'Complete profile setup before setting PIN',
      );
    }

    const hash = await hashPin(pin);

    await this.prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: { pinHash: hash, onboardingStatus: 'pin_setup' },
    });

    return { success: true, message: 'PIN set successfully' };
  }

  async verifyPin(userId: string, pin: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user?.pinHash) throw new BadRequestException('No PIN is set');

    const match = await verifyPinHash(pin, user.pinHash);
    if (!match) throw new BadRequestException('Incorrect PIN');

    return { success: true, message: 'PIN verified successfully' };
  }

  // ----------------------------------------------------------
  // PIN RESET VIA OTP (EMAIL)
  // ----------------------------------------------------------

  async requestPinResetOtp(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Delete any existing PIN reset tokens for this user
    await this.prisma.token.deleteMany({
      where: { userId: user.id, type: 'pin_reset' },
    });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // OTP expires in 1 hour
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Hash the OTP before storing
    const crypto = await import('crypto');
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    await this.prisma.token.create({
      data: {
        userId: user.id,
        token: hashedOtp,
        expiresAt,
        type: 'pin_reset',
      },
    });

    // Send OTP via email using notification service
    const resp = await this.notificationService.sendNotification('PinReset', {
      email: user.email,
      otp,
      userName: user.name,
    });

    if (!resp.success) {
      throw new ServiceUnavailableException(
        resp.error || 'Failed to send pin reset email',
      );
    }

    return { message: 'Pin reset token sent' };
  }

  async validatePinResetOtp(userId: string, otp: string) {
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('OTP must be exactly 6 digits');
    }

    const crypto = await import('crypto');
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    const resetToken = await this.prisma.token.findFirst({
      where: {
        userId,
        token: hashedOtp,
        type: 'pin_reset',
      },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid OTP');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    return { success: true, message: 'Valid OTP' };
  }

  async resetPinWithOtp(userId: string, otp: string, newPin: string) {
    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('OTP must be exactly 6 digits');
    }

    // Validate PIN format
    if (!/^\d{6}$/.test(newPin)) {
      throw new BadRequestException('PIN must be exactly 6 digits');
    }

    const crypto = await import('crypto');
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    // Verify OTP
    const resetToken = await this.prisma.token.findFirst({
      where: {
        userId,
        token: hashedOtp,
        type: 'pin_reset',
      },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid OTP');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Check if new PIN is same as old PIN (using bcrypt)
    if (user.pinHash) {
      const isSameAsOld = await verifyPinHash(newPin, user.pinHash);
      if (isSameAsOld) {
        throw new BadRequestException('New PIN cannot be the same as old PIN');
      }
    }

    // Hash and save new PIN using bcrypt
    const pinHash = await hashPin(newPin);

    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });

    // Delete the used OTP token
    await this.prisma.token.delete({ where: { id: resetToken.id } });

    return { success: true, message: 'PIN has been reset successfully' };
  }
}
