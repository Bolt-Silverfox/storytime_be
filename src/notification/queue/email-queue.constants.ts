/**
 * Email Queue Constants
 * Centralized configuration for the email queue system
 */

export const EMAIL_QUEUE_NAME = 'email-queue';

export const EMAIL_JOB_NAMES = {
  SEND_EMAIL: 'send-email',
} as const;

/**
 * Retry configuration with exponential backoff
 * Attempts: 1 (immediate) + 5 retries = 6 total attempts
 * Backoff: 30s, 1m, 2m, 4m, 8m (exponential with factor 2)
 */
export const EMAIL_QUEUE_DEFAULT_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 30000, // Start with 30 seconds
  },
  removeOnComplete: {
    age: 24 * 3600, // Keep completed jobs for 24 hours
    count: 1000, // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep failed jobs for 7 days for debugging
  },
};

/**
 * Queue-level settings
 */
export const EMAIL_QUEUE_SETTINGS = {
  defaultJobOptions: EMAIL_QUEUE_DEFAULT_OPTIONS,
};
