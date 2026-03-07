export const TTS_BATCH_QUEUE_NAME = 'tts-batch-queue';

export const TTS_BATCH_JOB_NAMES = {
  GENERATE_PARAGRAPHS: 'generate-paragraphs',
} as const;

/** Number of paragraphs to generate eagerly before queueing the rest */
export const EAGER_PARAGRAPH_COUNT = 2;

/** Redis key prefix for batch status tracking */
export const TTS_BATCH_REDIS_PREFIX = 'tts-batch';

/** TTL for batch tracking Redis keys (30 minutes) */
export const TTS_BATCH_REDIS_TTL = 1800;

export const TTS_BATCH_QUEUE_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 1800, count: 500 },
  removeOnFail: { age: 1800 },
};
