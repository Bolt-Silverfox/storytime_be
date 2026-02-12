/**
 * Voice Queue Constants
 * Centralized configuration for the voice synthesis queue system
 */

export const VOICE_QUEUE_NAME = 'voice-synthesis-queue';

export const VOICE_JOB_NAMES = {
  SYNTHESIZE_TEXT: 'synthesize-text',
  SYNTHESIZE_STORY: 'synthesize-story',
} as const;

/**
 * Retry configuration with exponential backoff
 * Voice synthesis is generally faster than story generation
 * Attempts: 1 (immediate) + 3 retries = 4 total attempts
 * Backoff: 30s, 60s, 120s (exponential with factor 2)
 */
export const VOICE_QUEUE_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 30000, // Start with 30 seconds
  },
  removeOnComplete: {
    age: 2 * 3600, // Keep completed jobs for 2 hours (result retrieval window)
    count: 1000, // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 24 * 3600, // Keep failed jobs for 24 hours for debugging
  },
};

/**
 * Queue-level settings
 */
export const VOICE_QUEUE_SETTINGS = {
  defaultJobOptions: VOICE_QUEUE_DEFAULT_OPTIONS,
};

/**
 * Job progress stages for tracking
 */
export const VOICE_SYNTHESIS_STAGES = {
  QUEUED: 0,
  PROCESSING: 10,
  SYNTHESIZING: 40,
  UPLOADING: 80,
  COMPLETED: 100,
} as const;

/**
 * Average synthesis time estimates (in seconds)
 * Used for wait time calculations
 */
export const VOICE_SYNTHESIS_ESTIMATES = {
  /** Average time per 1000 characters */
  PER_1000_CHARS: 5,
  /** Minimum synthesis time */
  MIN_TIME: 3,
  /** Maximum synthesis time */
  MAX_TIME: 60,
  /** Upload overhead */
  UPLOAD_OVERHEAD: 2,
} as const;
