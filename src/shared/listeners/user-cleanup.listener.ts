import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { AppEvents, UserDeletedEvent } from '@/shared/events';

/**
 * Handles cleanup operations when a user is deleted.
 * Ensures data consistency and GDPR compliance.
 */
@Injectable()
export class UserCleanupListener {
  private readonly logger = new Logger(UserCleanupListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(AppEvents.USER_DELETED)
  async onUserDeleted(event: UserDeletedEvent): Promise<void> {
    const userId = event.userId;
    this.logger.log(
      `Starting cleanup for deleted user ${userId.substring(0, 8)}`,
    );

    try {
      // Soft-delete all active sessions
      await this.prisma.session.updateMany({
        where: { userId, isDeleted: false },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      // Cancel active subscriptions
      await this.prisma.subscription.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'cancelled', endsAt: new Date() },
      });

      this.logger.log(
        `Cleanup completed for deleted user ${userId.substring(0, 8)}`,
      );
    } catch (error) {
      this.logger.error(
        `Cleanup failed for deleted user ${userId.substring(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
