/**
 * Story Queue Constants
 * Centralized configuration for the story generation queue system
 */

export const STORY_QUEUE_NAME = 'story-generation-queue';

export const STORY_JOB_NAMES = {
  GENERATE_STORY: 'generate-story',
  GENERATE_STORY_FOR_KID: 'generate-story-for-kid',
} as const;

/**
 * Retry configuration with exponential backoff
 * Story generation is expensive - use fewer retries with longer delays
 * Attempts: 1 (immediate) + 3 retries = 4 total attempts
 * Backoff: 1m, 2m, 4m (exponential with factor 2)
 */
export const STORY_QUEUE_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 60000, // Start with 1 minute (story gen is slow)
  },
  removeOnComplete: {
    age: 2 * 3600, // Keep completed jobs for 2 hours (result retrieval window)
    count: 500, // Keep last 500 completed jobs
  },
  removeOnFail: {
    age: 24 * 3600, // Keep failed jobs for 24 hours for debugging
  },
};

/**
 * Queue-level settings
 */
export const STORY_QUEUE_SETTINGS = {
  defaultJobOptions: STORY_QUEUE_DEFAULT_OPTIONS,
};

/**
 * Job progress stages for tracking
 */
export const STORY_GENERATION_STAGES = {
  QUEUED: 0,
  PROCESSING: 10,
  GENERATING_CONTENT: 30,
  GENERATING_IMAGE: 50,
  GENERATING_AUDIO: 70,
  PERSISTING: 90,
  COMPLETED: 100,
} as const;
