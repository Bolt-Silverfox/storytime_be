import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TTS_BATCH_QUEUE_NAME } from './tts-batch-queue.constants';
import {
  TtsBatchJobData,
  TtsBatchJobResult,
  TtsBatchStatus,
} from './tts-batch-job.interface';
import { TtsBatchQueueService } from './tts-batch-queue.service';
import { TextToSpeechService } from '../../story/text-to-speech.service';
import { QuotaExhaustedError } from '../errors/quota-exhausted.error';

const MAX_CONCURRENT_PER_JOB = 5;

type TtsProvider = 'elevenlabs' | 'deepgram' | 'edgetts';

/** Fallback chain when a provider's quota is exhausted */
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

  async process(job: Job<TtsBatchJobData>): Promise<TtsBatchJobResult> {
    const {
      batchJobId,
      storyId,
      voiceId,
      userId,
      isPremium,
      provider,
      paragraphs,
    } = job.data;

    this.logger.log(
      `Processing TTS batch ${batchJobId}: ${paragraphs.length} paragraphs for story ${storyId} with ${provider}`,
    );

    let completedCount = 0;
    let failedCount = 0;
    let currentProvider: TtsProvider = provider;

    for (let i = 0; i < paragraphs.length; i += MAX_CONCURRENT_PER_JOB) {
      const chunk = paragraphs.slice(i, i + MAX_CONCURRENT_PER_JOB);

      const results = await Promise.allSettled(
        chunk.map(async ({ index, text }) => {
          const result = await this.ttsService.generateSingleParagraphTTS(
            storyId,
            text,
            voiceId,
            userId,
            { isPremium, providerOverride: currentProvider },
          );
          return { index, audioUrl: result.audioUrl };
        }),
      );

      // Detect quota exhaustion — switch provider for remaining chunks
      const hasQuotaError = results.some(
        (r) => r.status === 'rejected' && this.isQuotaError(r.reason),
      );

      if (hasQuotaError) {
        const fallbacks = PROVIDER_FALLBACK[currentProvider] ?? [];
        if (fallbacks.length > 0) {
          this.logger.warn(
            `TTS batch ${batchJobId}: ${currentProvider} quota exhausted, switching to ${fallbacks[0]} for remaining paragraphs`,
          );
          currentProvider = fallbacks[0];
        }
      }

      // Collect quota-failed paragraphs for retry through the fallback chain
      let retryParagraphs: Array<{ index: number; text: string }> = [];

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const paragraph = chunk[j];
        const paragraphIndex = paragraph.index;
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
            completedCount++;
          } catch (redisErr) {
            this.logger.error(
              `TTS batch ${batchJobId}: Redis write failed for completed paragraph ${paragraphIndex}`,
              redisErr,
            );
            throw redisErr;
          }
        } else if (hasQuotaError && this.isQuotaError(result.reason)) {
          retryParagraphs.push({ index: paragraphIndex, text: paragraph.text });
        } else {
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          this.logger.warn(
            `TTS batch ${batchJobId}: TTS generation failed for paragraph ${paragraphIndex} — ${errorMessage}`,
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
          failedCount++;
        }
      }

      // Cascade quota-failed paragraphs through the remaining fallback chain
      let retryProvider: TtsProvider | undefined = hasQuotaError
        ? currentProvider
        : undefined;

      while (retryParagraphs.length > 0 && retryProvider) {
        this.logger.log(
          `TTS batch ${batchJobId}: retrying ${retryParagraphs.length} quota-failed paragraphs with ${retryProvider}`,
        );

        const retryResults = await Promise.allSettled(
          retryParagraphs.map(async ({ index, text }) => {
            const result = await this.ttsService.generateSingleParagraphTTS(
              storyId,
              text,
              voiceId,
              userId,
              { isPremium, providerOverride: retryProvider! },
            );
            return { index, audioUrl: result.audioUrl };
          }),
        );

        const nextRetryParagraphs: Array<{ index: number; text: string }> = [];

        for (let r = 0; r < retryResults.length; r++) {
          const retryResult = retryResults[r];
          const retryParagraph = retryParagraphs[r];
          const allRetryIndices = this.getDuplicateIndices(
            paragraphs,
            retryParagraph.index,
          );

          if (retryResult.status === 'fulfilled') {
            try {
              for (const idx of allRetryIndices) {
                await this.queueService.markParagraphCompleted(
                  batchJobId,
                  idx,
                  retryResult.value.audioUrl,
                );
              }
              completedCount++;
            } catch (redisErr) {
              this.logger.error(
                `TTS batch ${batchJobId}: Redis write failed for retried paragraph ${retryParagraph.index}`,
                redisErr,
              );
              throw redisErr;
            }
          } else if (this.isQuotaError(retryResult.reason)) {
            // Cascade to next provider
            nextRetryParagraphs.push({
              index: retryParagraph.index,
              text: retryParagraph.text,
            });
          } else {
            const retryErrorMsg =
              retryResult.reason instanceof Error
                ? retryResult.reason.message
                : String(retryResult.reason);
            this.logger.warn(
              `TTS batch ${batchJobId}: retry with ${retryProvider} failed for paragraph ${retryParagraph.index} — ${retryErrorMsg}`,
            );
            try {
              for (const idx of allRetryIndices) {
                await this.queueService.markParagraphFailed(batchJobId, idx);
              }
            } catch (redisErr) {
              this.logger.error(
                `TTS batch ${batchJobId}: Redis write failed for failed retry paragraph ${retryParagraph.index}`,
                redisErr,
              );
              throw redisErr;
            }
            failedCount++;
          }
        }

        // Advance to the next provider in the fallback chain
        retryParagraphs = nextRetryParagraphs;
        if (retryParagraphs.length > 0) {
          const nextFallbacks = PROVIDER_FALLBACK[retryProvider] ?? [];
          if (nextFallbacks.length > 0) {
            this.logger.warn(
              `TTS batch ${batchJobId}: ${retryProvider} quota also exhausted, cascading to ${nextFallbacks[0]}`,
            );
            retryProvider = nextFallbacks[0];
            currentProvider = retryProvider;
          } else {
            // No more providers — mark remaining as failed
            this.logger.error(
              `TTS batch ${batchJobId}: all providers exhausted, marking ${retryParagraphs.length} paragraphs as failed`,
            );
            for (const p of retryParagraphs) {
              const allIndices = this.getDuplicateIndices(paragraphs, p.index);
              for (const idx of allIndices) {
                await this.queueService.markParagraphFailed(batchJobId, idx);
              }
              failedCount++;
            }
            retryParagraphs = [];
            retryProvider = undefined;
          }
        }
      }
    }

    const success = failedCount === 0;
    const status = success ? TtsBatchStatus.COMPLETED : TtsBatchStatus.FAILED;

    await this.queueService.updateBatchMeta(batchJobId, {
      status,
      ...(failedCount > 0
        ? { error: `${failedCount}/${paragraphs.length} paragraphs failed` }
        : {}),
    });

    this.logger.log(
      `TTS batch ${batchJobId} finished: ${completedCount} completed, ${failedCount} failed`,
    );

    return { success, completedCount, failedCount };
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
