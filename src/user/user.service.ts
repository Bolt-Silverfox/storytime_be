import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { UserRole } from './user.controller';
import { UpdateUserDto } from './dto/user.dto';
import { hashPin, verifyPinHash } from './utils/pin.util';
import * as bcrypt from 'bcrypt';
import { NotificationService } from '@/notification/notification.service';

const prisma = new PrismaClient();

@Injectable()
export class UserService {
  constructor(private notificationService: NotificationService) {}

  async getUser(id: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
      include: { profile: true, kids: true, avatar: true },
    });
    if (!user) return null;

    return { ...user, numberOfKids: user.kids.length };
  }

  /**
   * Get user including deleted ones (for checking account status)
   */
  async getUserIncludingDeleted(id: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { profile: true, kids: true, avatar: true },
    });

    if (user) {
      return { ...user, numberOfKids: user.kids.length };
    }
    return null;
  }

  /**
   * Get all users (admin only) - includes both active and soft deleted users
   */
  async getAllUsers(): Promise<any[]> {
    return prisma.user.findMany({
      include: {
        profile: true,
        avatar: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get only active users (non-admin)
   */
  async getActiveUsers(): Promise<any[]> {
    return prisma.user.findMany({
      where: {
        isDeleted: false,
      },
      include: { profile: true, avatar: true },
    });
  }

  /**
   * Soft delete or permanently delete a user
   * @param id User ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async deleteUser(id: string, permanent: boolean = false): Promise<any> {
    try {
      if (permanent) {
        // Check if user exists first
        const existingUser = await prisma.user.findUnique({
          where: { id },
        });

        if (!existingUser) {
          throw new NotFoundException('Account not found');
        }

        // TERMINATE ALL SESSIONS BEFORE PERMANENT DELETE
        await this.terminateUserSessions(id);

        // Delete the user and all associated data
        const deletedUser = await prisma.user.delete({ where: { id } });

        return {
          id: deletedUser.id,
          email: deletedUser.email,
          message:
            'Account and all associated data deleted permanently. All active sessions have been terminated.',
          permanent: true,
        };
      } else {
        const updatedUser = await prisma.user.update({
          where: { id },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });

        return {
          ...updatedUser,
          message: 'Account deactivated successfully',
          permanent: false,
        };
      }
    } catch (error) {
      // Handle Prisma errors
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('Account not found');
        } else if (error.code === 'P2003') {
          // Foreign key constraint - cascade delete not properly set up
          throw new BadRequestException(
            'Cannot permanently delete account with associated data. ' +
              'Please use soft delete (deactivation) or contact support to delete all associated data first.',
          );
        }
      }

      throw new BadRequestException(
        error.message || 'Failed to delete account',
      );
    }
  }

  /**
   * Terminate all user sessions and tokens (for permanent delete only)
   */
  private async terminateUserSessions(userId: string): Promise<void> {
    try {
      // Delete all active sessions
      await prisma.session.deleteMany({
        where: { userId },
      });

      // Delete all tokens
      await prisma.token.deleteMany({
        where: { userId },
      });

      // Create activity log for session termination
      await prisma.activityLog.create({
        data: {
          userId,
          action: 'SESSION_TERMINATION',
          status: 'SUCCESS',
          details: 'All sessions terminated due to permanent account deletion',
          createdAt: new Date(),
        },
      });
    } catch (error) {
      // If session termination fails, log it but continue with deletion
      await prisma.activityLog.create({
        data: {
          userId,
          action: 'SESSION_TERMINATION',
          status: 'FAILED',
          details: `Failed to terminate sessions: ${error.message}`,
          createdAt: new Date(),
        },
      });
    }
  }

  /**
   * Soft delete or permanently delete user account
   * @param id User ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async deleteUserAccount(
    id: string,
    permanent: boolean = false,
  ): Promise<any> {
    return this.deleteUser(id, permanent);
  }

  /**
   * Verify password and create deletion log (for POST /me/delete)
   * @param userId User ID
   * @param password User password for verification
   * @param reasons Optional array of deletion reasons
   * @param notes Optional additional notes
   * @param permanent Whether permanent deletion was requested
   */
  async verifyPasswordAndLogDeletion(
    userId: string,
    password: string,
    reasons?: string[],
    notes?: string,
    permanent: boolean = false,
  ) {
    // Find user regardless of deletion status
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is already deleted
    if (user.isDeleted) {
      throw new BadRequestException(
        'Account is already deactivated. Please restore your account first or contact support.',
      );
    }

    // Verify password
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Invalid password');
    }

    // Create support ticket for deletion request
    const messageLines = [
      'Deletion request submitted - PASSWORD VERIFIED',
      reasons?.length ? `Reasons: ${reasons.join(', ')}` : '',
      notes ? `Notes: ${notes}` : '',
      permanent
        ? 'Permanent deletion requested'
        : 'Soft deletion (deactivation) requested',
      `User: ${user.email} (${user.name})`,
      `Password verified at: ${new Date().toISOString()}`,
    ];

    // Add warning about session termination for permanent delete
    if (permanent) {
      messageLines.push(
        '⚠️ WARNING: All active sessions will be terminated immediately upon permanent deletion.',
      );
    }

    await prisma.supportTicket.create({
      data: {
        userId,
        subject: 'Delete Account Request',
        message: messageLines.join('\n'),
      },
    });

    return {
      success: true,
      message: 'Password verified. Account deletion request submitted.',
    };
  }

  /**
   * Restore a soft deleted user
   * @param id User ID
   */
  async undoDeleteUser(id: string): Promise<any> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isDeleted) throw new BadRequestException('User is not deleted');

    const restoredUser = await prisma.user.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      include: { profile: true, kids: true, avatar: true },
    });

    // Log restoration
    await prisma.supportTicket.create({
      data: {
        userId: id,
        subject: 'Account Restoration',
        message: `Account restored by admin at ${new Date().toISOString()}`,
      },
    });

    return restoredUser;
  }

  /**
   * Restore the current user's account
   * @param userId Current user ID
   */
  async undoDeleteMyAccount(userId: string): Promise<any> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isDeleted)
      throw new BadRequestException('Your account is not deleted');

    const restoredUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      include: { profile: true, kids: true, avatar: true },
    });

    // Log self-restoration
    await prisma.supportTicket.create({
      data: {
        userId,
        subject: 'Account Self-Restoration',
        message: `User restored their own account at ${new Date().toISOString()}`,
      },
    });

    return restoredUser;
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    const user = await prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const updateData: any = {};
    const profileUpdate: any = {};

    // -------- USER FIELDS --------
    if (data.title !== undefined) updateData.title = data.title;
    if (data.name !== undefined) updateData.name = data.name;

    // Avatar logic
    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    } else if (data.avatarUrl !== undefined) {
      const newAvatar = await prisma.avatar.create({
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

    const updatedUser = await prisma.user.update({
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
      },
      include: { profile: true, kids: true, avatar: true },
    });

    return {
      ...updatedUser,
      numberOfKids: updatedUser.kids.length,
    };
  }

  async getUserRole(id: string) {
    const u = await prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
      },
    });
    return { id: u?.id, role: u?.role };
  }

  async updateUserRole(id: string, role: UserRole) {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error('Invalid role');
    }

    const user = await prisma.user.update({
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

  async updateParentProfile(userId: string, data: any) {
    const existing = await prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!existing) throw new NotFoundException('User not found');

    const updateUser: any = {};
    const updateProfile: any = {};

    if (data.name !== undefined) updateUser.name = data.name;
    if (data.title !== undefined) updateUser.title = data.title;
    if (data.language !== undefined) updateProfile.language = data.language;
    if (data.country !== undefined) updateProfile.country = data.country;

    return prisma.user.update({
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
      },
      include: { profile: true, avatar: true },
    });
  }

  async updateAvatarForParent(userId: string, body: any) {
    if (!body.avatarId) throw new BadRequestException('avatarId is required');

    return prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: { avatarId: body.avatarId },
      include: { avatar: true },
    });
  }

  // ----------------------------------------------------------
  // BIOMETRICS + PIN
  // ----------------------------------------------------------

  async setBiometrics(userId: string, enable: boolean) {
    const updated = await prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: { enableBiometrics: enable },
    });

    return {
      success: true,
      enableBiometrics: !!updated.enableBiometrics,
    };
  }

  async setPin(userId: string, pin: string) {
    if (!/^\d{6}$/.test(pin))
      throw new BadRequestException('PIN must be exactly 6 digits');

    const hash = await hashPin(pin);

    await prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: { pinHash: hash },
    });

    return { success: true, message: 'PIN set successfully' };
  }

  // ----------------------------------------------------------
  // PIN RESET VIA OTP (EMAIL)
  // ----------------------------------------------------------

  async requestPinResetOtp(userId: string) {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Delete any existing PIN reset tokens for this user
    await prisma.token.deleteMany({
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

    await prisma.token.create({
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

    const resetToken = await prisma.token.findFirst({
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
      await prisma.token.delete({ where: { id: resetToken.id } });
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
    const resetToken = await prisma.token.findFirst({
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
      await prisma.token.delete({ where: { id: resetToken.id } });
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    const user = await prisma.user.findUnique({
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

    await prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });

    // Delete the used OTP token
    await prisma.token.delete({ where: { id: resetToken.id } });

    return { success: true, message: 'PIN has been reset successfully' };
  }
}
