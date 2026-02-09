import { NotificationCategory } from '@prisma/client';

/**
 * Base interface for all notification providers
 */
export interface INotificationProvider {
  /**
   * Send a notification through this provider
   * @param payload The notification payload
   * @returns Success status and optional message ID or error
   */
  send(payload: NotificationPayload): Promise<NotificationResult>;
}

/**
 * Common notification payload structure
 */
export interface NotificationPayload {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, unknown>; // Additional metadata
}

/**
 * Result of a notification send operation
 */
export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
