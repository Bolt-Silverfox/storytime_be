import { Injectable, Inject } from '@nestjs/common';
import {
  IInAppNotificationRepository,
  IN_APP_NOTIFICATION_REPOSITORY,
} from '../repositories';

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
