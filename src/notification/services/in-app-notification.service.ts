import { Injectable, Inject } from '@nestjs/common';
import {
  IInAppNotificationRepository,
  IN_APP_NOTIFICATION_REPOSITORY,
} from '../repositories';
import { buildCursorPaginatedResponse } from '@/shared/utils/cursor-pagination.helper';

@Injectable()
export class InAppNotificationService {
  constructor(
    @Inject(IN_APP_NOTIFICATION_REPOSITORY)
    private readonly inAppNotificationRepository: IInAppNotificationRepository,
  ) {}

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
