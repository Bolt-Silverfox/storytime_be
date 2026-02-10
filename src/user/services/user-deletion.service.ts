import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, User, Profile, Kid, Avatar } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents, UserDeletedEvent } from '@/shared/events';

/** Response for permanent delete operation */
export interface DeleteUserResult {
  id: string;
  email: string;
  message: string;
  permanent: boolean;
}

/** Response for soft delete operation */
export type SoftDeleteUserResult = User & {
  message: string;
  permanent: boolean;
};

/** User with relations after restore */
type UserWithRelations = User & {
  profile?: Profile | null;
  kids?: Kid[];
  avatar?: Avatar | null;
};

@Injectable()
export class UserDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Soft delete or permanently delete a user
   * @param id User ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async deleteUser(
    id: string,
    permanent: boolean = false,
  ): Promise<DeleteUserResult | SoftDeleteUserResult> {
    try {
      if (permanent) {
        // Check if user exists first
        const existingUser = await this.prisma.user.findUnique({
          where: { id },
        });

        if (!existingUser) {
          throw new NotFoundException('Account not found');
        }

        // TERMINATE ALL SESSIONS BEFORE PERMANENT DELETE
        await this.terminateUserSessions(id);

        // Delete the user and all associated data
        const deletedUser = await this.prisma.user.delete({ where: { id } });

        // Emit user deleted event
        const deletedEvent: UserDeletedEvent = {
          userId: deletedUser.id,
          email: deletedUser.email,
          deletedAt: new Date(),
          reason: 'permanent_delete',
        };
        this.eventEmitter.emit(AppEvents.USER_DELETED, deletedEvent);

        return {
          id: deletedUser.id,
          email: deletedUser.email,
          message:
            'Account and all associated data deleted permanently. All active sessions have been terminated.',
          permanent: true,
        };
      } else {
        const updatedUser = await this.prisma.user.update({
          where: { id },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });

        // Emit user deleted event (soft delete)
        const deletedEvent: UserDeletedEvent = {
          userId: updatedUser.id,
          email: updatedUser.email,
          deletedAt: updatedUser.deletedAt!,
          reason: 'soft_delete',
        };
        this.eventEmitter.emit(AppEvents.USER_DELETED, deletedEvent);

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
      await this.prisma.session.deleteMany({
        where: { userId },
      });

      // Delete all tokens
      await this.prisma.token.deleteMany({
        where: { userId },
      });

      // Create activity log for session termination
      await this.prisma.activityLog.create({
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
      await this.prisma.activityLog.create({
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
  ): Promise<DeleteUserResult | SoftDeleteUserResult> {
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
    const user = await this.prisma.user.findUnique({
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

    await this.prisma.supportTicket.create({
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
  async undoDeleteUser(id: string): Promise<UserWithRelations> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isDeleted) throw new BadRequestException('User is not deleted');

    const restoredUser = await this.prisma.user.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      include: { profile: true, kids: true, avatar: true },
    });

    // Log restoration
    await this.prisma.supportTicket.create({
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
  async undoDeleteMyAccount(userId: string): Promise<UserWithRelations> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isDeleted)
      throw new BadRequestException('Your account is not deleted');

    const restoredUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      include: { profile: true, kids: true, avatar: true },
    });

    // Log self-restoration
    await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: 'Account Self-Restoration',
        message: `User restored their own account at ${new Date().toISOString()}`,
      },
    });

    return restoredUser;
  }
}
