import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IInAppNotificationRepository,
  IN_APP_NOTIFICATION_REPOSITORY,
} from '../repositories';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from './notification-provider.interface';

/**
 * In-App Notification Provider
 * Stores notifications in the database for retrieval via API
 */
@Injectable()
export class InAppProvider implements INotificationProvider {
  constructor(
    @Inject(IN_APP_NOTIFICATION_REPOSITORY)
    private readonly inAppNotificationRepository: IInAppNotificationRepository,
  ) {}

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      const notification =
        await this.inAppNotificationRepository.createNotification({
          userId: payload.userId,
          category: payload.category,
          title: payload.title,
          body: payload.body,
          data: (payload.data ?? {}) as unknown as Prisma.InputJsonValue,
          isRead: false,
        });

      return {
        success: true,
        messageId: notification.id,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create in-app notification',
      };
    }
  }
}
