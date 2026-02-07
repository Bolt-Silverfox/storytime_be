import { NotificationCategory } from '@prisma/client';

/**
 * Email job data structure
 * This is serialized and stored in Redis
 */
export interface EmailJobData {
  /** Unique identifier for tracking */
  jobId: string;

  /** User ID for logging and tracking */
  userId: string;

  /** Notification category for metrics */
  category: NotificationCategory;

  /** Recipient email address */
  to: string;

  /** Email subject line */
  subject: string;

  /** Rendered HTML body */
  html: string;

  /** Original notification payload for retry context */
  metadata?: {
    templateName?: string;
    originalData?: Record<string, unknown>;
  };
}

/**
 * Email job result returned by processor
 */
export interface EmailJobResult {
  success: boolean;
  messageId?: string;
  error?: string;
  attemptsMade: number;
}

/**
 * Email job priority levels
 */
export enum EmailPriority {
  /** Critical emails: password reset, email verification */
  HIGH = 1,
  /** Standard transactional emails */
  NORMAL = 5,
  /** Marketing, digests, non-urgent */
  LOW = 10,
}

/**
 * Map notification categories to priority
 */
export const CATEGORY_PRIORITY_MAP: Partial<Record<NotificationCategory, EmailPriority>> = {
  EMAIL_VERIFICATION: EmailPriority.HIGH,
  PASSWORD_RESET: EmailPriority.HIGH,
  PASSWORD_RESET_ALERT: EmailPriority.HIGH,
  PASSWORD_CHANGED: EmailPriority.HIGH,
  PIN_RESET: EmailPriority.HIGH,
  NEW_LOGIN: EmailPriority.HIGH,
  PAYMENT_FAILED: EmailPriority.HIGH,
  FEEDBACK: EmailPriority.NORMAL,
  SUBSCRIPTION_ALERT: EmailPriority.NORMAL,
  PAYMENT_SUCCESS: EmailPriority.NORMAL,
  NEW_STORY: EmailPriority.LOW,
  STORY_RECOMMENDATION: EmailPriority.LOW,
  WE_MISS_YOU: EmailPriority.LOW,
  WEEKLY_REPORT: EmailPriority.LOW,
};
