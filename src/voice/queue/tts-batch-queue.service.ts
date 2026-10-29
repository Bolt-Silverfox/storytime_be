import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
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

/** Max time a start holds the per-(story, voice) lock (crash safety). */
const START_LOCK_TTL_SECONDS = 60;
/** How long a second start waits for the first before failing open. */
const START_LOCK_WAIT_MS = 20_000;
const START_LOCK_POLL_MS = 200;

const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export interface StartLock {
  release(): Promise<void>;
}

const NOOP_LOCK: StartLock = { release: () => Promise.resolve() };

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

  private inFlightKey(storyId: string, voiceId: string): string {
    return `${TTS_BATCH_REDIS_PREFIX}:inflight:${storyId}:${voiceId}`;
  }

  /**
   * Serialises "check cache -> generate -> queue" for one (story, voice) so two
   * simultaneous starts do not both generate the same paragraphs. A second
   * caller waits (bounded) for the first to finish, after which its own cache
   * lookup hits and it joins the in-flight batch via {@link findInFlightBatch}.
   * NEVER throws: if Redis is unavailable, or the wait budget is exhausted, it
   * returns a no-op lock so the caller proceeds exactly as before.
   */
  async acquireStartLock(
    storyId: string,
    voiceId: string,
    opts: { waitMs?: number; pollMs?: number } = {},
  ): Promise<StartLock> {
    const key = `${TTS_BATCH_REDIS_PREFIX}:start-lock:${storyId}:${voiceId}`;
    const token = randomUUID();
    const waitMs = opts.waitMs ?? START_LOCK_WAIT_MS;
    const pollMs = opts.pollMs ?? START_LOCK_POLL_MS;
    const deadline = Date.now() + waitMs;
    try {
      for (;;) {
        const ok = await this.redis.set(
          key,
          token,
          'EX',
          START_LOCK_TTL_SECONDS,
          'NX',
        );
        if (ok === 'OK') {
          return {
            release: async () => {
              try {
                await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
              } catch {
                // best effort: the TTL frees it
              }
            },
          };
        }
        if (Date.now() >= deadline) {
          this.logger.warn(
            `Start lock for ${storyId}/${voiceId} still held after ${waitMs}ms; proceeding without it`,
          );
          return NOOP_LOCK;
        }
        await sleep(pollMs);
      }
    } catch (error) {
      this.logger.warn(
        `Start lock unavailable for ${storyId}/${voiceId}: ${(error as Error).message}`,
      );
      return NOOP_LOCK;
    }
  }

  /** The still-processing batch for (story, voice), if any. Never throws. */
  async findInFlightBatch(
    storyId: string,
    voiceId: string,
  ): Promise<string | null> {
    try {
      const batchJobId = await this.redis.get(
        this.inFlightKey(storyId, voiceId),
      );
      if (!batchJobId) return null;
      const meta = await this.redis.hgetall(
        `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`,
      );
      return (meta.status as TtsBatchStatus) === TtsBatchStatus.PROCESSING
        ? batchJobId
        : null;
    } catch {
      return null;
    }
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
      storyId: data.storyId,
      ...(data.isGuest ? { isGuest: '1' } : {}),
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

    // Marker so a concurrent/subsequent start for the same (story, voice) can
    // join this batch instead of generating the same paragraphs again.
    try {
      await this.redis.set(
        this.inFlightKey(data.storyId, data.voiceId),
        batchJobId,
        'EX',
        TTS_BATCH_REDIS_TTL,
      );
    } catch (error) {
      this.logger.warn(
        `Could not record in-flight marker for ${data.storyId}: ${(error as Error).message}`,
      );
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

    await this.batchQueue.add(
      TTS_BATCH_JOB_NAMES.GENERATE_PARAGRAPHS,
      jobData,
      {
        ...TTS_BATCH_QUEUE_OPTIONS,
        // BullMQ (>=5.61) rejects ':' in custom job IDs — it is the reserved
        // internal key separator — so use hyphens or the enqueue throws and the
        // retry is never scheduled.
        jobId: `${batchJobId}-retry-${generation}`,
        delay: TTS_BATCH_RETRY_DELAY_MS,
      },
    );

    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const completedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:completed`;
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;
    // The retry job is durably enqueued above, so a TTL-refresh failure must NOT
    // propagate: the caller treats a throw from this method as "retry was never
    // scheduled" and fails the batch terminally (emitting a failure SSE) even
    // though the delayed job would still run. Worst case the status keys expire
    // on their original TTL and polling clients lose the snapshot, which the
    // aggregate-state read already tolerates.
    try {
      const pipeline = this.redis.pipeline();
      pipeline.expire(metaKey, TTS_BATCH_REDIS_TTL);
      pipeline.expire(completedKey, TTS_BATCH_REDIS_TTL);
      pipeline.expire(failedKey, TTS_BATCH_REDIS_TTL);
      // ioredis resolves exec() with one [error, result] tuple per command, so
      // an EXPIRE that failed does NOT reject — surface the first command error
      // to the catch below rather than silently reporting success.
      const results = await pipeline.exec();
      const commandError = results?.find(([error]) => error)?.[0];
      if (commandError) throw commandError;
    } catch (ttlErr) {
      this.logger.warn(
        `TTS batch retry ${batchJobId} (generation ${generation}) was enqueued, but refreshing Redis TTLs failed: ${
          ttlErr instanceof Error ? ttlErr.message : String(ttlErr)
        }`,
      );
    }

    this.logger.log(
      `TTS batch retry queued: ${batchJobId} (generation ${generation}) — ${failedParagraphs.length} paragraph(s), delay ${TTS_BATCH_RETRY_DELAY_MS}ms`,
    );
  }

  async getBatchStatus(
    batchJobId: string,
    userId?: string,
    opts: { storyId?: string; allowSharedGuest?: boolean } = {},
  ): Promise<TtsBatchStatusResponse | null> {
    const metaKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:meta`;
    const completedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:completed`;
    const failedKey = `${TTS_BATCH_REDIS_PREFIX}:${batchJobId}:failed`;

    const meta = await this.redis.hgetall(metaKey);
    if (!meta.status) return null;

    // Verify ownership if userId is provided
    // Guest batches are shared by every guest session on the same story
    // (concurrent starts join one batch); they only contain public audio URLs.
    const sharedGuest = opts.allowSharedGuest === true && meta.isGuest === '1';
    if (userId && meta.userId && meta.userId !== userId && !sharedGuest) {
      return null;
    }
    if (opts.storyId && meta.storyId !== opts.storyId) return null;

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
