import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TextToSpeechService } from '@/story/text-to-speech.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FcmService } from '@/notification/services/fcm.service';
import { JobEventsService } from '@/notification/services/job-events.service';
import {
  VOICE_QUEUE_NAME,
  VOICE_SYNTHESIS_STAGES,
} from './voice-queue.constants';
import { VoiceJobData, VoiceJobResult } from './voice-job.interface';
import {
  NonRetryableProcessingException,
  VoiceSynthesisException,
} from '@/shared/exceptions/processing.exception';
import { DomainException } from '@/shared/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/**
 * Voice Queue Processor
 * Handles voice synthesis jobs with progress tracking and retry support
 *
 * Concurrency is set to 3 (TTS is faster than story generation)
 */
@Processor(VOICE_QUEUE_NAME, { concurrency: 3 })
export class VoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceProcessor.name);

  constructor(
    private readonly textToSpeechService: TextToSpeechService,
    private readonly prisma: PrismaService,
    private readonly fcmService: FcmService,
    private readonly jobEventsService: JobEventsService,
  ) {
    super();
  }

  /**
   * Process voice synthesis job
   * This method is called by BullMQ for each job
   */
  async process(job: Job<VoiceJobData>): Promise<VoiceJobResult> {
    const { jobId, userId, type } = job.data;
    const attemptsMade = job.attemptsMade + 1;
    const startTime = Date.now();

    this.logger.log(
      `Processing voice job ${jobId} (attempt ${attemptsMade}): ${type} for user ${userId}`,
    );

    try {
      // Stage: Processing
      await job.updateProgress(VOICE_SYNTHESIS_STAGES.PROCESSING);

      let audioUrl: string;

      if (type === 'synthesize-text') {
        audioUrl = await this.processSynthesizeText(job);
      } else if (type === 'synthesize-story') {
        audioUrl = await this.processSynthesizeStory(job);
      } else {
        throw new NonRetryableProcessingException(
          `Unknown job type: ${String(type)}`,
          { type },
        );
      }

      // Stage: Completed
      await job.updateProgress(VOICE_SYNTHESIS_STAGES.COMPLETED);

      const processingTimeMs = Date.now() - startTime;

      this.logger.log(
        `Voice job ${jobId} completed successfully in ${processingTimeMs}ms`,
      );

      return {
        success: true,
        audioUrl,
        attemptsMade,
        processingTimeMs,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const processingTimeMs = Date.now() - startTime;

      this.logger.error(
        `Voice job ${jobId} failed (attempt ${attemptsMade}): ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Check if this is a non-retryable error
      if (this.isNonRetryableError(error)) {
        return {
          success: false,
          error: errorMessage,
          errorCode: 'NON_RETRYABLE',
          attemptsMade,
          processingTimeMs,
        };
      }

      // Throw error to trigger retry (if retryable)
      throw new VoiceSynthesisException(errorMessage);
    }
  }

  /**
   * Process text synthesis (raw text to audio)
   */
  private async processSynthesizeText(job: Job<VoiceJobData>): Promise<string> {
    const { textSynthesis, userId, jobId } = job.data;

    if (!textSynthesis) {
      throw new NonRetryableProcessingException(
        'Missing textSynthesis data for synthesize-text job',
      );
    }

    const { text, voiceType, customVoiceId } = textSynthesis;

    if (!text || text.trim().length === 0) {
      throw new NonRetryableProcessingException('Text content is empty');
    }

    // Stage: Synthesizing
    await job.updateProgress(VOICE_SYNTHESIS_STAGES.SYNTHESIZING);

    // Use custom voice ID if provided, otherwise voice type
    const voiceId = customVoiceId ?? voiceType;

    const audioUrl = await this.textToSpeechService.synthesizeStory(
      jobId, // Use jobId as the identifier for the audio file
      text,
      voiceId,
      userId,
    );

    // Stage: Uploading (already done by synthesizeStory)
    await job.updateProgress(VOICE_SYNTHESIS_STAGES.UPLOADING);

    return audioUrl;
  }

  /**
   * Process story synthesis (generate audio for existing story)
   */
  private async processSynthesizeStory(
    job: Job<VoiceJobData>,
  ): Promise<string> {
    const { storySynthesis, userId } = job.data;

    if (!storySynthesis) {
      throw new NonRetryableProcessingException(
        'Missing storySynthesis data for synthesize-story job',
      );
    }

    const { storyId, voiceType, customVoiceId, updateStory } = storySynthesis;

    // Fetch story content
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, textContent: true, title: true },
    });

    if (!story) {
      throw new NonRetryableProcessingException(`Story ${storyId} not found`, {
        storyId,
      });
    }

    if (!story.textContent || story.textContent.trim().length === 0) {
      throw new NonRetryableProcessingException(
        `Story ${storyId} has no text content`,
        { storyId },
      );
    }

    // Stage: Synthesizing
    await job.updateProgress(VOICE_SYNTHESIS_STAGES.SYNTHESIZING);

    // Use custom voice ID if provided, otherwise voice type
    const voiceId = customVoiceId ?? voiceType;

    const audioUrl = await this.textToSpeechService.synthesizeStory(
      storyId,
      story.textContent,
      voiceId,
      userId,
    );

    // Stage: Uploading
    await job.updateProgress(VOICE_SYNTHESIS_STAGES.UPLOADING);

    // Optionally update the story record with the new audio URL
    if (updateStory) {
      await this.prisma.story.update({
        where: { id: storyId },
        data: { audioUrl },
      });

      this.logger.log(`Updated story ${storyId} with new audio URL`);
    }

    return audioUrl;
  }

  /**
   * Check if error should not trigger retry
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof NonRetryableProcessingException) return true;

    // Check for DomainException with 4xx status (except 429 Too Many Requests)
    if (error instanceof DomainException) {
      const status = error.getStatus();
      return (
        status >= 400 &&
        status < 500 &&
        status !== Number(HttpStatus.TOO_MANY_REQUESTS)
      );
    }

    if (!(error instanceof Error)) return false;

    const nonRetryablePatterns = [
      'not found',
      'validation failed',
      'invalid input',
      'unauthorized',
      'forbidden',
      'empty',
      'no text content',
    ];

    const message = error.message.toLowerCase();
    return nonRetryablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * Called when a job completes successfully
   */
  @OnWorkerEvent('completed')
  async onCompleted(
    job: Job<VoiceJobData>,
    result: VoiceJobResult,
  ): Promise<void> {
    this.logger.log(
      `Job ${job.data.jobId} completed: ${job.data.type} for user ${job.data.userId} ` +
        `(attempts: ${result.attemptsMade}, time: ${result.processingTimeMs}ms)`,
    );

    // Send push notification to mobile devices
    if (result.success && result.audioUrl) {
      await this.sendCompletionNotification(job.data, result);
    }
  }

  /**
   * Send completion notification via push notification and SSE
   */
  private async sendCompletionNotification(
    jobData: VoiceJobData,
    result: VoiceJobResult,
  ): Promise<void> {
    // Emit SSE event for web clients
    this.jobEventsService.emitVoiceCompleted(
      jobData.jobId,
      jobData.userId,
      result.audioUrl!,
    );

    // Send push notification to mobile devices
    try {
      const pushResult = await this.fcmService.sendVoiceCompletionNotification(
        jobData.userId,
        jobData.jobId,
        result.audioUrl!,
      );

      this.logger.log(
        `Push notification sent for voice job ${jobData.jobId}: ${pushResult.successCount} devices`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send push notification for voice job ${jobData.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Called when a job fails (before retry or permanently)
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VoiceJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error('Job failed with no job data', error.stack);
      return;
    }

    const { jobId, userId, type } = job.data;
    const willRetry = job.attemptsMade < (job.opts.attempts || 0);

    if (willRetry) {
      this.logger.warn(
        `Job ${jobId} failed (attempt ${job.attemptsMade}), will retry: ${error.message}`,
      );
    } else {
      this.logger.error(
        `Job ${jobId} permanently failed after ${job.attemptsMade} attempts: ` +
          `${type} for user ${userId} - ${error.message}`,
        error.stack,
      );

      // Send failure notification to user
      await this.sendFailureNotification(job.data, error.message);
    }
  }

  /**
   * Send failure notification for permanent failures via push and SSE
   */
  private async sendFailureNotification(
    jobData: VoiceJobData,
    errorMessage: string,
  ): Promise<void> {
    // Emit SSE event for web clients
    this.jobEventsService.emitFailed(
      jobData.jobId,
      jobData.userId,
      'voice',
      errorMessage,
    );

    // Send push notification to mobile devices
    try {
      await this.fcmService.sendVoiceFailureNotification(
        jobData.userId,
        jobData.jobId,
        errorMessage,
      );
      this.logger.log(
        `Failure notification sent for voice job ${jobData.jobId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send failure notification for voice job ${jobData.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Called when worker becomes active (starts processing a job)
   */
  @OnWorkerEvent('active')
  onActive(job: Job<VoiceJobData>): void {
    this.logger.debug(
      `Processing job ${job.data.jobId}: ${job.data.type} for user ${job.data.userId}`,
    );
  }

  /**
   * Called when worker encounters an error
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error('Worker error:', error.stack);
  }

  /**
   * Called when worker stalls (job takes too long)
   */
  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Job ${jobId} has stalled`);
  }
}
