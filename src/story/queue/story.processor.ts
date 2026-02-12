import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoryGenerationService } from '../story-generation.service';
import { FcmService } from '@/notification/services/fcm.service';
import { JobEventsService } from '@/notification/services/job-events.service';
import {
  STORY_QUEUE_NAME,
  STORY_GENERATION_STAGES,
} from './story-queue.constants';
import {
  StoryJobData,
  StoryJobResult,
  StoryResult,
} from './story-job.interface';
import {
  NonRetryableProcessingException,
  StoryGenerationException,
} from '@/shared/exceptions/processing.exception';
import { DomainException } from '@/shared/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/**
 * Story Queue Processor
 * Handles story generation jobs with progress tracking and retry support
 *
 * Concurrency is set to 2 to prevent overwhelming AI APIs
 * (lower than email queue's 10)
 */
@Processor(STORY_QUEUE_NAME, { concurrency: 2 })
export class StoryProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryProcessor.name);

  constructor(
    private readonly storyGenerationService: StoryGenerationService,
    private readonly fcmService: FcmService,
    private readonly jobEventsService: JobEventsService,
  ) {
    super();
  }

  /**
   * Process story generation job
   * This method is called by BullMQ for each job
   */
  async process(job: Job<StoryJobData>): Promise<StoryJobResult> {
    const { jobId, userId, type } = job.data;
    const attemptsMade = job.attemptsMade + 1;
    const startTime = Date.now();

    this.logger.log(
      `Processing story job ${jobId} (attempt ${attemptsMade}): ${type} for user ${userId}`,
    );

    try {
      // Stage: Processing
      await job.updateProgress(STORY_GENERATION_STAGES.PROCESSING);

      let story: StoryResult;

      if (type === 'generate') {
        story = await this.processGenerateStory(job);
      } else if (type === 'generate-for-kid') {
        story = await this.processGenerateForKid(job);
      } else {
        throw new NonRetryableProcessingException(
          `Unknown job type: ${String(type)}`,
          { type },
        );
      }

      // Stage: Completed
      await job.updateProgress(STORY_GENERATION_STAGES.COMPLETED);

      const processingTimeMs = Date.now() - startTime;

      this.logger.log(
        `Story job ${jobId} completed successfully in ${processingTimeMs}ms`,
      );

      return {
        success: true,
        storyId: story.id,
        story,
        attemptsMade,
        processingTimeMs,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const processingTimeMs = Date.now() - startTime;

      this.logger.error(
        `Story job ${jobId} failed (attempt ${attemptsMade}): ${errorMessage}`,
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
      throw new StoryGenerationException(errorMessage);
    }
  }

  /**
   * Process standard story generation
   */
  private async processGenerateStory(
    job: Job<StoryJobData>,
  ): Promise<StoryResult> {
    const { options } = job.data;

    if (!options) {
      throw new NonRetryableProcessingException(
        'Missing options for story generation',
      );
    }

    // Stage: Generating Content
    await job.updateProgress(STORY_GENERATION_STAGES.GENERATING_CONTENT);

    // Note: The service handles image/audio generation internally
    // We update progress stages for client visibility
    const story = await this.storyGenerationService.generateStoryWithAI({
      theme: options.theme,
      category: options.category,
      seasonIds: options.seasonIds,
      ageMin: options.ageMin,
      ageMax: options.ageMax,
      kidName: options.kidName,
      language: options.language,
      additionalContext: options.additionalContext,
      voiceType: options.voiceType,
    });

    // Stage: Persisting (DB transaction happens in service)
    await job.updateProgress(STORY_GENERATION_STAGES.PERSISTING);

    return this.transformStoryResult(story);
  }

  /**
   * Process kid-specific story generation
   */
  private async processGenerateForKid(
    job: Job<StoryJobData>,
  ): Promise<StoryResult> {
    const { kidGeneration } = job.data;

    if (!kidGeneration) {
      throw new NonRetryableProcessingException(
        'Missing kidGeneration data for generate-for-kid job',
      );
    }

    // Stage: Generating Content
    await job.updateProgress(STORY_GENERATION_STAGES.GENERATING_CONTENT);

    const story = await this.storyGenerationService.generateStoryForKid(
      kidGeneration.kidId,
      kidGeneration.themes,
      kidGeneration.categories,
      kidGeneration.seasonIds,
      kidGeneration.kidName,
    );

    // Stage: Persisting
    await job.updateProgress(STORY_GENERATION_STAGES.PERSISTING);

    return this.transformStoryResult(story);
  }

  /**
   * Transform Prisma story result to StoryResult interface
   */
  private transformStoryResult(story: any): StoryResult {
    return {
      id: story.id,
      title: story.title,
      description: story.description,
      language: story.language,
      coverImageUrl: story.coverImageUrl || '',
      audioUrl: story.audioUrl || '',
      textContent: story.textContent,
      ageMin: story.ageMin,
      ageMax: story.ageMax,
      wordCount: story.wordCount,
      durationSeconds: story.durationSeconds,
      aiGenerated: story.aiGenerated,
      createdAt: story.createdAt,
      categories:
        story.categories?.map((c: any) => ({
          id: c.id,
          name: c.name,
        })) || [],
      themes:
        story.themes?.map((t: any) => ({
          id: t.id,
          name: t.name,
        })) || [],
      seasons: story.seasons?.map((s: any) => ({
        id: s.id,
        name: s.name,
      })),
    };
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
        status >= 400 && status < 500 && status !== HttpStatus.TOO_MANY_REQUESTS
      );
    }

    if (!(error instanceof Error)) return false;

    const nonRetryablePatterns = [
      'not found',
      'validation failed',
      'invalid input',
      'unauthorized',
      'forbidden',
    ];

    const message = error.message.toLowerCase();
    return nonRetryablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * Called when a job completes successfully
   */
  @OnWorkerEvent('completed')
  async onCompleted(
    job: Job<StoryJobData>,
    result: StoryJobResult,
  ): Promise<void> {
    this.logger.log(
      `Job ${job.data.jobId} completed: ${job.data.type} for user ${job.data.userId} ` +
        `(attempts: ${result.attemptsMade}, time: ${result.processingTimeMs}ms, storyId: ${result.storyId})`,
    );

    // Send push notification to mobile devices
    if (result.success && result.story) {
      await this.sendCompletionNotification(job.data, result);
    }
  }

  /**
   * Send completion notification via push notification and SSE
   */
  private async sendCompletionNotification(
    jobData: StoryJobData,
    result: StoryJobResult,
  ): Promise<void> {
    // Emit SSE event for web clients
    this.jobEventsService.emitStoryCompleted(
      jobData.jobId,
      jobData.userId,
      result.storyId!,
      result.story!.title,
    );

    // Send push notification to mobile devices
    try {
      const pushResult = await this.fcmService.sendStoryCompletionNotification(
        jobData.userId,
        result.storyId!,
        result.story!.title,
      );

      this.logger.log(
        `Push notification sent for job ${jobData.jobId}: ${pushResult.successCount} devices`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send push notification for job ${jobData.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Push notification failures are logged but don't fail the job
      // User can still poll for status or check their stories list
    }
  }

  /**
   * Called when a job fails (before retry or permanently)
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<StoryJobData> | undefined,
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
    jobData: StoryJobData,
    errorMessage: string,
  ): Promise<void> {
    // Emit SSE event for web clients
    this.jobEventsService.emitFailed(
      jobData.jobId,
      jobData.userId,
      'story',
      errorMessage,
    );

    // Send push notification to mobile devices
    try {
      await this.fcmService.sendStoryFailureNotification(
        jobData.userId,
        jobData.jobId,
        errorMessage,
      );
      this.logger.log(`Failure notification sent for job ${jobData.jobId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send failure notification for job ${jobData.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Called when worker becomes active (starts processing a job)
   */
  @OnWorkerEvent('active')
  onActive(job: Job<StoryJobData>): void {
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
