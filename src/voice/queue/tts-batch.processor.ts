import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  MAX_RETRY_GENERATIONS,
  TTS_BATCH_QUEUE_NAME,
} from './tts-batch-queue.constants';
import {
  TtsBatchJobData,
  TtsBatchJobResult,
  TtsBatchStatus,
} from './tts-batch-job.interface';
import { TtsBatchQueueService } from './tts-batch-queue.service';
import { TextToSpeechService } from '../../story/text-to-speech.service';
import { QuotaExhaustedError } from '../errors/quota-exhausted.error';

const MAX_CONCURRENT_PER_JOB = 5;

/** Transient (non-quota) retries on the SAME provider before cascading */
const MAX_ATTEMPTS_PER_PROVIDER = 2;

/** Base backoff (ms) between transient retries on the same provider */
const RETRY_BACKOFF_MS = 300;

type TtsProvider = 'elevenlabs' | 'deepgram' | 'edgetts';

/** Provider precedence — used to only advance the shared hint forwards */
const PROVIDER_ORDER: TtsProvider[] = ['elevenlabs', 'deepgram', 'edgetts'];

/** Fallback chain when a provider fails (quota exhaustion or transient errors) */
const PROVIDER_FALLBACK: Record<TtsProvider, TtsProvider[]> = {
  elevenlabs: ['deepgram', 'edgetts'],
  deepgram: ['edgetts'],
  edgetts: [],
};

@Processor(TTS_BATCH_QUEUE_NAME, { concurrency: 3 })
export class TtsBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(TtsBatchProcessor.name);

  constructor(
    private readonly queueService: TtsBatchQueueService,
    private readonly ttsService: TextToSpeechService,
  ) {
    super();
  }

  /** Check if a rejection reason indicates quota/payment exhaustion */
  private isQuotaError(reason: unknown): boolean {
    if (reason instanceof QuotaExhaustedError) return true;
    if (reason && typeof reason === 'object') {
      const err = reason as Record<string, unknown>;
      // Raw HTTP 402 from providers that don't wrap in QuotaExhaustedError
      if (err.status === 402 || err.statusCode === 402) return true;
      // Axios errors store status on response.status
      const response = err.response as Record<string, unknown> | undefined;
      if (response?.status === 402) return true;
    }
    return false;
  }

  /** Resolve duplicate indices for a paragraph from the original job data */
  private getDuplicateIndices(
    paragraphs: TtsBatchJobData['paragraphs'],
    index: number,
  ): number[] {
    return [
      index,
      ...(paragraphs.find((p) => p.index === index)?.duplicateIndices ?? []),
    ];
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async process(job: Job<TtsBatchJobData>): Promise<TtsBatchJobResult> {
    const {
      batchJobId,
      storyId,
      voiceId,
      userId,
      isPremium,
      provider,
      paragraphs,
      totalParagraphs,
      retryGeneration,
    } = job.data;

    const generation = retryGeneration ?? 0;

    this.logger.log(
      `Processing TTS batch ${batchJobId} (generation ${generation}): ${paragraphs.length} paragraphs for story ${storyId} with ${provider}`,
    );

    let completedCount = 0;
    let failedCount = 0;
    // Paragraphs that exhausted the whole provider chain this run — candidates
    // for a delayed self-heal round.
    const failedThisRun: TtsBatchJobData['paragraphs'] = [];

    // Shared hint: once we learn a provider is quota-exhausted, later paragraphs
    // start straight from the next provider instead of re-hitting the dead one.
    // It only ever moves forwards through PROVIDER_ORDER.
    let preferredProvider: TtsProvider = provider;

    const advancePreferred = (exhausted: TtsProvider): void => {
      const next = PROVIDER_FALLBACK[exhausted]?.[0];
      if (
        next &&
        PROVIDER_ORDER.indexOf(next) > PROVIDER_ORDER.indexOf(preferredProvider)
      ) {
        preferredProvider = next;
      }
    };

    /**
     * Generate a single paragraph, walking the provider fallback chain.
     * - Transient errors: retried up to MAX_ATTEMPTS_PER_PROVIDER on the SAME
     *   provider (with backoff), then cascade to the next provider.
     * - Quota errors: no point retrying the same provider — cascade immediately.
     * Throws the last error only after the whole chain is exhausted.
     */
    const generateWithFallback = async (
      index: number,
      text: string,
    ): Promise<{ index: number; audioUrl: string }> => {
      const chain: TtsProvider[] = [
        preferredProvider,
        ...PROVIDER_FALLBACK[preferredProvider],
      ];
      let lastError: unknown;

      for (const activeProvider of chain) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
          try {
            const result = await this.ttsService.generateSingleParagraphTTS(
              storyId,
              text,
              voiceId,
              userId,
              { isPremium, providerOverride: activeProvider },
            );
            return { index, audioUrl: result.audioUrl };
          } catch (err) {
            lastError = err;

            if (this.isQuotaError(err)) {
              // Quota exhausted — retrying the same provider is pointless.
              this.logger.warn(
                `TTS batch ${batchJobId}: ${activeProvider} quota exhausted for paragraph ${index}, cascading to fallback`,
              );
              advancePreferred(activeProvider);
              break; // move to the next provider in the chain
            }

            const errorMessage =
              err instanceof Error ? err.message : String(err);
            if (attempt < MAX_ATTEMPTS_PER_PROVIDER) {
              this.logger.warn(
                `TTS batch ${batchJobId}: transient failure on ${activeProvider} for paragraph ${index} (attempt ${attempt}/${MAX_ATTEMPTS_PER_PROVIDER}) — ${errorMessage}; retrying`,
              );
              await this.delay(RETRY_BACKOFF_MS * attempt);
            } else {
              this.logger.warn(
                `TTS batch ${batchJobId}: ${activeProvider} exhausted retries for paragraph ${index} — ${errorMessage}; cascading to fallback`,
              );
            }
          }
        }
      }

      throw lastError;
    };

    for (let i = 0; i < paragraphs.length; i += MAX_CONCURRENT_PER_JOB) {
      const chunk = paragraphs.slice(i, i + MAX_CONCURRENT_PER_JOB);

      const results = await Promise.allSettled(
        chunk.map(({ index, text }) => generateWithFallback(index, text)),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const paragraphIndex = chunk[j].index;
        const allIndices = this.getDuplicateIndices(paragraphs, paragraphIndex);

        if (result.status === 'fulfilled') {
          try {
            for (const idx of allIndices) {
              await this.queueService.markParagraphCompleted(
                batchJobId,
                idx,
                result.value.audioUrl,
              );
            }
            // A generated paragraph stands in for every duplicate position, so
            // count each persisted index — otherwise the counters disagree with
            // the completed/failed sets in Redis whenever duplicates exist.
            completedCount += allIndices.length;
          } catch (redisErr) {
            this.logger.error(
              `TTS batch ${batchJobId}: Redis write failed for completed paragraph ${paragraphIndex}`,
              redisErr,
            );
            throw redisErr;
          }
        } else {
          // Only reached once every provider + retry has been exhausted.
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          this.logger.warn(
            `TTS batch ${batchJobId}: paragraph ${paragraphIndex} failed after all providers — ${errorMessage}`,
          );
          try {
            for (const idx of allIndices) {
              await this.queueService.markParagraphFailed(batchJobId, idx);
            }
          } catch (redisErr) {
            this.logger.error(
              `TTS batch ${batchJobId}: Redis write failed for failed paragraph ${paragraphIndex}`,
              redisErr,
            );
            throw redisErr;
          }
          // Count every duplicate position this paragraph was persisted under,
          // mirroring the completed path so the counters stay consistent with
          // the failed set in Redis.
          failedCount += allIndices.length;
          failedThisRun.push(chunk[j]);
        }
      }
    }

    // Self-heal: schedule a delayed follow-up for paragraphs that exhausted the
    // whole provider chain this run, bounded by MAX_RETRY_GENERATIONS so it can
    // never loop. The retry re-uses this batchJobId, so recovered paragraphs
    // heal in place for anyone still polling the batch.
    if (failedThisRun.length > 0 && generation < MAX_RETRY_GENERATIONS) {
      try {
        await this.queueService.queueRetryBatch(
          job.data,
          failedThisRun,
          generation + 1,
        );
        this.logger.log(
          `TTS batch ${batchJobId}: scheduled self-heal (generation ${generation + 1}) for ${failedThisRun.length} paragraph(s)`,
        );
      } catch (retryErr) {
        this.logger.error(
          `TTS batch ${batchJobId}: failed to schedule self-heal retry`,
          retryErr,
        );
      }
    }

    // Derive the batch status from the AGGREGATE Redis state, not this run's
    // local counts: a retry run only touches a subset and must never clobber an
    // already-partially-good batch back to FAILED. A batch with ANY usable
    // audio is COMPLETED (partial narration is playable per-paragraph); only an
    // all-failed batch is FAILED. An empty error string clears a stale
    // partial-failure note once the batch has fully healed.
    const snapshot = await this.queueService.getBatchStatus(batchJobId);
    const aggregateCompleted =
      snapshot?.completedParagraphs.length ?? completedCount;
    const aggregateFailed = snapshot?.failedParagraphs.length ?? failedCount;
    const totalQueued = snapshot?.totalQueued ?? totalParagraphs;

    const status =
      aggregateCompleted > 0 ? TtsBatchStatus.COMPLETED : TtsBatchStatus.FAILED;

    await this.queueService.updateBatchMeta(batchJobId, {
      status,
      error:
        aggregateFailed > 0
          ? `${aggregateFailed}/${totalQueued} paragraphs failed`
          : '',
    });

    this.logger.log(
      `TTS batch ${batchJobId} finished (generation ${generation}): ${completedCount} completed / ${failedCount} failed this run; aggregate ${aggregateCompleted} completed / ${aggregateFailed} failed`,
    );

    return { success: aggregateFailed === 0, completedCount, failedCount };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<TtsBatchJobData> | undefined, error: Error): void {
    if (!job) {
      this.logger.error('TTS batch job failed with no job data', error.stack);
      return;
    }

    const { batchJobId } = job.data;
    this.logger.error(
      `TTS batch ${batchJobId} permanently failed: ${error.message}`,
      error.stack,
    );

    this.queueService
      .updateBatchMeta(batchJobId, {
        status: TtsBatchStatus.FAILED,
        error: error.message,
      })
      .catch((err) =>
        this.logger.error(`Failed to update batch meta for ${batchJobId}`, err),
      );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error('TTS batch worker error:', error.stack);
  }
}
