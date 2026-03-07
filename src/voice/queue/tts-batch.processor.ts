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

const MAX_CONCURRENT_PER_JOB = 5;

@Processor(TTS_BATCH_QUEUE_NAME, { concurrency: 3 })
export class TtsBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(TtsBatchProcessor.name);

  constructor(
    private readonly queueService: TtsBatchQueueService,
    private readonly ttsService: TextToSpeechService,
  ) {
    super();
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

    for (let i = 0; i < paragraphs.length; i += MAX_CONCURRENT_PER_JOB) {
      const chunk = paragraphs.slice(i, i + MAX_CONCURRENT_PER_JOB);

      const results = await Promise.allSettled(
        chunk.map(async ({ index, text }) => {
          const result = await this.ttsService.generateSingleParagraphTTS(
            storyId,
            text,
            voiceId,
            userId,
            { isPremium, providerOverride: provider },
          );
          return { index, audioUrl: result.audioUrl };
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const paragraph = chunk[j];
        const paragraphIndex = paragraph.index;
        const allIndices = [
          paragraphIndex,
          ...(paragraph.duplicateIndices ?? []),
        ];

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
              await this.queueService.markParagraphFailed(
                batchJobId,
                idx,
              );
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
