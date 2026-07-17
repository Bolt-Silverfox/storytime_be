export const TTS_BATCH_QUEUE_NAME = 'tts-batch-queue';

export const TTS_BATCH_JOB_NAMES = {
  GENERATE_PARAGRAPHS: 'generate-paragraphs',
} as const;

/**
 * Number of initial paragraphs to deliver eagerly before queueing the
 * remainder for background generation. The first N paragraphs are generated
 * synchronously so the client can start playback immediately.
 */
export const EAGER_PARAGRAPH_COUNT = 2;

/** Redis key prefix for batch status tracking */
export const TTS_BATCH_REDIS_PREFIX = 'tts-batch';

/** TTL for batch tracking Redis keys (30 minutes) */
export const TTS_BATCH_REDIS_TTL = 1800;

/**
 * Maximum number of delayed self-heal rounds after the initial run. Each round
 * re-attempts only the paragraphs that exhausted the whole provider chain, so
 * this bounds the total work and guarantees the chain can't loop forever.
 */
export const MAX_RETRY_GENERATIONS = 2;

/**
 * Delay before a self-heal retry job runs. Gives a transient provider outage
 * time to recover before we re-attempt the failed paragraphs.
 */
export const TTS_BATCH_RETRY_DELAY_MS = 45_000;

export const TTS_BATCH_QUEUE_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 1800, count: 500 },
  removeOnFail: { age: 1800 },
};
