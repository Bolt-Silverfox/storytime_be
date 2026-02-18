/**
 * Push Queue Constants
 * Centralized configuration for the push notification queue system
 */

export const PUSH_QUEUE_NAME = 'push-queue';

export const PUSH_JOB_NAMES = {
  SEND_PUSH: 'send-push',
  SEND_PUSH_BATCH: 'send-push-batch',
  SEND_PUSH_TOPIC: 'send-push-topic',
} as const;

/**
 * Retry configuration with exponential backoff
 * Attempts: 4 total (1 initial + 3 retries)
 * Backoff delays: 10s, 20s, 40s (exponential from 10s base)
 * Faster than email since push notifications are more time-sensitive
 */
export const PUSH_QUEUE_DEFAULT_OPTIONS = {
  attempts: 4,
  backoff: {
    type: 'exponential' as const,
    delay: 10000, // Start with 10 seconds
  },
  removeOnComplete: {
    age: 12 * 3600, // Keep completed jobs for 12 hours
    count: 500, // Keep last 500 completed jobs
  },
  removeOnFail: {
    age: 3 * 24 * 3600, // Keep failed jobs for 3 days
  },
};

/**
 * Queue-level settings
 */
export const PUSH_QUEUE_SETTINGS = {
  defaultJobOptions: PUSH_QUEUE_DEFAULT_OPTIONS,
};
