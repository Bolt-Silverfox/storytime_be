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
 * Attempts: 1 (immediate) + 3 retries = 4 total attempts
 * Backoff: 10s, 30s, 1m (faster than email since push is more time-sensitive)
 */
export const PUSH_QUEUE_DEFAULT_OPTIONS = {
  attempts: 3,
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
