import { NotificationCategory } from '@prisma/client';

/**
 * Push notification job data structure
 * This is serialized and stored in Redis
 */
export interface PushJobData {
  /** Unique identifier for tracking */
  jobId: string;

  /** User ID to send the notification to */
  userId: string;

  /** Notification category for metrics and preferences */
  category: NotificationCategory;

  /** Notification title */
  title: string;

  /** Notification body */
  body: string;

  /** Custom data payload for the app */
  data?: Record<string, string>;

  /** Optional: specific device tokens to target (bypasses user lookup) */
  tokens?: string[];

  /** Android-specific options */
  android?: {
    channelId?: string;
    priority?: 'high' | 'normal';
  };

  /** iOS-specific options */
  ios?: {
    sound?: string;
    badge?: number;
  };
}

/**
 * Push notification job result
 */
export interface PushJobResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  messageId?: string;
  error?: string;
  attemptsMade: number;
}

/**
 * Batch push job data
 */
export interface PushBatchJobData {
  jobId: string;
  notifications: Array<{
    userId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    data?: Record<string, string>;
  }>;
}

/**
 * Topic push job data
 */
export interface PushTopicJobData {
  jobId: string;
  topic: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Push notification priority levels
 */
export enum PushPriority {
  /** Time-critical: auth alerts, payment issues */
  HIGH = 1,
  /** Standard notifications */
  NORMAL = 5,
  /** Non-urgent: recommendations, reminders */
  LOW = 10,
}

/**
 * Map notification categories to push priority
 */
export const PUSH_CATEGORY_PRIORITY_MAP: Partial<
  Record<NotificationCategory, PushPriority>
> = {
  // High priority - security/payment related
  PASSWORD_RESET_ALERT: PushPriority.HIGH,
  PASSWORD_CHANGED: PushPriority.HIGH,
  NEW_LOGIN: PushPriority.HIGH,
  PAYMENT_FAILED: PushPriority.HIGH,
  SUBSCRIPTION_ALERT: PushPriority.HIGH,

  // Normal priority - engagement
  NEW_STORY: PushPriority.NORMAL,
  STORY_FINISHED: PushPriority.NORMAL,
  ACHIEVEMENT_UNLOCKED: PushPriority.NORMAL,
  BADGE_EARNED: PushPriority.NORMAL,
  STREAK_MILESTONE: PushPriority.NORMAL,
  FEEDBACK: PushPriority.NORMAL,

  // Low priority - reminders
  INCOMPLETE_STORY_REMINDER: PushPriority.LOW,
  DAILY_LISTENING_REMINDER: PushPriority.LOW,
  DAILY_CHALLENGE_REMINDER: PushPriority.LOW,
  BEDTIME_REMINDER: PushPriority.LOW,
  WEEKLY_REPORT: PushPriority.LOW,
  STORY_RECOMMENDATION: PushPriority.LOW,
  WE_MISS_YOU: PushPriority.LOW,
};
