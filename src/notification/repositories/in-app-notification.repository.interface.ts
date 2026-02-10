import type { Notification } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IInAppNotificationRepository {
  // Find notifications with pagination and filtering
  findNotifications(params: {
    userId: string;
    limit: number;
    offset: number;
    unreadOnly?: boolean;
  }): Promise<Notification[]>;

  // Count notifications matching criteria
  countNotifications(params: {
    userId: string;
    unreadOnly?: boolean;
  }): Promise<number>;

  // Mark specific notifications as read
  markNotificationsAsRead(params: {
    userId: string;
    notificationIds: string[];
  }): Promise<{ count: number }>;

  // Mark all unread notifications as read for a user
  markAllNotificationsAsRead(userId: string): Promise<{ count: number }>;
}

export const IN_APP_NOTIFICATION_REPOSITORY = Symbol(
  'IN_APP_NOTIFICATION_REPOSITORY',
);
