import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import {
  TTS_BATCH_QUEUE_NAME,
  TTS_BATCH_JOB_NAMES,
  TTS_BATCH_QUEUE_OPTIONS,
  TTS_BATCH_REDIS_PREFIX,
  TTS_BATCH_REDIS_TTL,
  TTS_BATCH_RETRY_DELAY_MS,
} from './tts-batch-queue.constants';
import {
  TtsBatchJobData,
  TtsBatchStatus,
  TtsBatchStatusResponse,
} from './tts-batch-job.interface';
import { TTS_BATCH_REDIS } from './tts-batch-redis.provider';

@Injectable()
export class TtsBatchQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(TtsBatchQueueService.name);

  constructor(
    @InjectQueue(TTS_BATCH_QUEUE_NAME)
    private readonly batchQueue: Queue<TtsBatchJobData>,
    @Inject(TTS_BATCH_REDIS)
    private readonly redis: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  async queueBatch(data: Omit<TtsBatchJobData, 'batchJobId'>): Promise<string> {
    const batchJobId = randomUUID();

    const jobData: TtsBatchJobData = { ...data, batchJobId };

    // Initialize Redis tracking keys
    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const completedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:completed`;
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;

    const pipeline = this.redis.pipeline();
    pipeline.hset(metaKey, {
      status: TtsBatchStatus.PROCESSING,
      totalQueued: String(data.paragraphs.length),
      userId: data.userId,
    });
    // Create empty hash/set so keys exist for TTL
    pipeline.hset(completedKey, '_placeholder', '');
    pipeline.sadd(failedKey, '_placeholder');
    pipeline.expire(metaKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(completedKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(failedKey, TTS_BATCH_REDIS_TTL);
    await pipeline.exec();

    try {
      await this.batchQueue.add(
        TTS_BATCH_JOB_NAMES.GENERATE_PARAGRAPHS,
        jobData,
        {
          ...TTS_BATCH_QUEUE_OPTIONS,
          jobId: batchJobId,
        },
      );
    } catch (error) {
      // Clean up Redis state keys so getBatchStatus won't report a stuck batch
      await this.redis.del(metaKey, completedKey, failedKey);
      throw error;
    }

    this.logger.log(
      `TTS batch queued: ${batchJobId} — ${data.paragraphs.length} paragraphs for story ${data.storyId}`,
    );

    return batchJobId;
  }

  /**
   * Queue a delayed self-heal round for paragraphs that exhausted the whole
   * provider chain. Re-uses the ORIGINAL batchJobId (so recovered paragraphs
   * land in the same completed/failed tracking sets and the client polling the
   * batch sees them heal), but with a distinct BullMQ jobId per generation and
   * a delay so a transient outage has time to recover. The tracking keys are
   * left intact — only their TTL is refreshed so they survive until the retry
   * runs.
   */
  async queueRetryBatch(
    original: TtsBatchJobData,
    failedParagraphs: TtsBatchJobData['paragraphs'],
    generation: number,
  ): Promise<void> {
    const { batchJobId } = original;

    const jobData: TtsBatchJobData = {
      ...original,
      paragraphs: failedParagraphs,
      retryGeneration: generation,
    };

    await this.batchQueue.add(TTS_BATCH_JOB_NAMES.GENERATE_PARAGRAPHS, jobData, {
      ...TTS_BATCH_QUEUE_OPTIONS,
      jobId: `${batchJobId}:retry:${generation}`,
      delay: TTS_BATCH_RETRY_DELAY_MS,
    });

    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const completedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:completed`;
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;
    const pipeline = this.redis.pipeline();
    pipeline.expire(metaKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(completedKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(failedKey, TTS_BATCH_REDIS_TTL);
    await pipeline.exec();

    this.logger.log(
      `TTS batch retry queued: ${batchJobId} (generation ${generation}) — ${failedParagraphs.length} paragraph(s), delay ${TTS_BATCH_RETRY_DELAY_MS}ms`,
    );
  }

  async getBatchStatus(
    batchJobId: string,
    userId?: string,
  ): Promise<TtsBatchStatusResponse | null> {
    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const completedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:completed`;
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;

    const meta = await this.redis.hgetall(metaKey);
    if (!meta.status) return null;

    // Verify ownership if userId is provided
    if (userId && meta.userId && meta.userId !== userId) return null;

    const completedMap = await this.redis.hgetall(completedKey);
    const failedMembers = await this.redis.smembers(failedKey);

    const completedParagraphs: Array<{ index: number; audioUrl: string }> = [];
    for (const [key, value] of Object.entries(completedMap)) {
      if (key === '_placeholder') continue;
      const index = Number(key);
      if (!Number.isInteger(index)) continue;
      completedParagraphs.push({ index, audioUrl: value });
    }

    const failedParagraphs = failedMembers
      .filter((m: string) => m !== '_placeholder')
      .map(Number)
      .filter((index) => Number.isInteger(index));

    return {
      status: meta.status as TtsBatchStatus,
      completedParagraphs,
      failedParagraphs,
      totalQueued: Number(meta.totalQueued),
      ...(meta.error ? { error: meta.error } : {}),
    };
  }

  async markParagraphCompleted(
    batchJobId: string,
    index: number,
    audioUrl: string,
  ): Promise<void> {
    const completedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:completed`;
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;
    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const pipeline = this.redis.pipeline();
    pipeline.hset(completedKey, String(index), audioUrl);
    // A self-heal retry can complete a paragraph that a previous run marked
    // failed — clear it from the failed set so it isn't reported in both.
    pipeline.srem(failedKey, String(index));
    pipeline.expire(completedKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(failedKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(metaKey, TTS_BATCH_REDIS_TTL);
    await pipeline.exec();
  }

  async markParagraphFailed(batchJobId: string, index: number): Promise<void> {
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;
    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const pipeline = this.redis.pipeline();
    pipeline.sadd(failedKey, String(index));
    pipeline.expire(failedKey, TTS_BATCH_REDIS_TTL);
    pipeline.expire(metaKey, TTS_BATCH_REDIS_TTL);
    await pipeline.exec();
  }

  async updateBatchMeta(
    batchJobId: string,
    updates: Partial<{ status: TtsBatchStatus; error: string }>,
  ): Promise<void> {
    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const fields: Record<string, string> = {};
    if (updates.status !== undefined) fields.status = updates.status;
    if (updates.error !== undefined) fields.error = updates.error;
    if (Object.keys(fields).length > 0) {
      const pipeline = this.redis.pipeline();
      pipeline.hset(metaKey, fields);
      pipeline.expire(metaKey, TTS_BATCH_REDIS_TTL);
      await pipeline.exec();
    }
  }
}
