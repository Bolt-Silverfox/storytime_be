import { Injectable, Inject, Logger } from '@nestjs/common';
import { NotificationCategory as PrismaCategory } from '@prisma/client';
import {
  IInAppNotificationRepository,
  IN_APP_NOTIFICATION_REPOSITORY,
  IUserRepository,
  USER_REPOSITORY,
} from '../repositories';
import { InAppProvider } from '../providers/in-app.provider';
import { buildCursorPaginatedResponse } from '@/shared/utils/cursor-pagination.helper';

@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(
    @Inject(IN_APP_NOTIFICATION_REPOSITORY)
    private readonly inAppNotificationRepository: IInAppNotificationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly inAppProvider: InAppProvider,
  ) {}

  /**
   * Write an in-app inbox record for every active user (batched). Used by admin
   * broadcasts so an announcement lands in the in-app inbox, not just push.
   * Best-effort per user; category defaults to SYSTEM_ALERT.
   */
  async broadcastInAppToAllUsers(
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<{ delivered: number; failed: number }> {
    const BATCH = 500;
    let cursor: string | undefined;
    let delivered = 0;
    let failed = 0;
    for (;;) {
      const users = await this.userRepository.findActiveUsersBatch({
        take: BATCH,
        cursor,
      });
      if (users.length === 0) {
        break;
      }
      for (const user of users) {
        try {
          const result = await this.inAppProvider.send({
            userId: user.id,
            category: PrismaCategory.SYSTEM_ALERT,
            title,
            body,
            data,
          });
          if (result.success) {
            delivered++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          this.logger.warn(
            `In-app broadcast failed for user ${user.id.substring(0, 8)}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) {
        break;
      }
    }
    this.logger.log(
      `In-app broadcast "${title}": ${delivered} delivered, ${failed} failed`,
    );
    return { delivered, failed };
  }

  async getInAppNotifications(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    unreadOnly: boolean = false,
  ) {
    const [notifications, total] = await Promise.all([
      this.inAppNotificationRepository.findNotifications({
        userId,
        limit,
        offset,
        unreadOnly,
      }),
      this.inAppNotificationRepository.countNotifications({
        userId,
        unreadOnly,
      }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        ...n,
        category: n.category,
      })),
      total,
    };
  }

  async getInAppNotificationsCursor(
    userId: string,
    cursorId: string | null,
    limit: number,
    unreadOnly: boolean = false,
  ) {
    const notifications =
      await this.inAppNotificationRepository.findNotificationsWithCursor({
        userId,
        cursor: cursorId ? { id: cursorId } : undefined,
        take: limit + 1,
        unreadOnly,
      });

    return buildCursorPaginatedResponse({
      items: notifications.map((n) => ({
        ...n,
        category: n.category,
      })),
      limit,
      cursorId,
      getId: (item) => item.id,
    });
  }

  async markAsRead(userId: string, notificationIds: string[]) {
    return this.inAppNotificationRepository.markNotificationsAsRead({
      userId,
      notificationIds,
    });
  }

  async markAllAsRead(userId: string) {
    return this.inAppNotificationRepository.markAllNotificationsAsRead(userId);
  }
}
