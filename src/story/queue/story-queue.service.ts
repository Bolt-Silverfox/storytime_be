import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { VoiceType } from '@/voice/dto/voice.dto';
import {
  STORY_QUEUE_NAME,
  STORY_JOB_NAMES,
  STORY_QUEUE_DEFAULT_OPTIONS,
  STORY_GENERATION_STAGES,
} from './story-queue.constants';
import {
  StoryJobData,
  StoryJobResult,
  StoryJobStatus,
  StoryJobStatusResponse,
  StoryPriority,
} from './story-job.interface';

export interface QueueStoryOptions {
  userId: string;
  theme: string[];
  category: string[];
  seasonIds?: string[];
  ageMin: number;
  ageMax: number;
  kidName?: string;
  language?: string;
  additionalContext?: string;
  voiceType?: VoiceType;
  priority?: StoryPriority;
  metadata?: {
    clientIp?: string;
    userAgent?: string;
  };
}

export interface QueueStoryForKidOptions {
  userId: string;
  kidId: string;
  themes?: string[];
  categories?: string[];
  seasonIds?: string[];
  kidName?: string;
  priority?: StoryPriority;
  metadata?: {
    clientIp?: string;
    userAgent?: string;
  };
}

export interface QueuedStoryResult {
  queued: boolean;
  jobId: string;
  estimatedWaitTime?: number;
  error?: string;
}

/**
 * Story Queue Service
 * Provides methods to add story generation jobs to the queue and check status
 */
@Injectable()
export class StoryQueueService {
  private readonly logger = new Logger(StoryQueueService.name);

  constructor(
    @InjectQueue(STORY_QUEUE_NAME)
    private readonly storyQueue: Queue<StoryJobData, StoryJobResult>,
  ) {}

  /**
   * Queue a story generation job
   */
  async queueStoryGeneration(
    options: QueueStoryOptions,
  ): Promise<QueuedStoryResult> {
    const jobId = uuidv4();

    try {
      const priority = options.priority ?? StoryPriority.NORMAL;

      const jobData: StoryJobData = {
        jobId,
        userId: options.userId,
        type: 'generate',
        options: {
          theme: options.theme,
          category: options.category,
          seasonIds: options.seasonIds,
          ageMin: options.ageMin,
          ageMax: options.ageMax,
          kidName: options.kidName,
          language: options.language,
          additionalContext: options.additionalContext,
          voiceType: options.voiceType,
        },
        metadata: {
          ...options.metadata,
          requestedAt: new Date(),
        },
      };

      await this.storyQueue.add(STORY_JOB_NAMES.GENERATE_STORY, jobData, {
        ...STORY_QUEUE_DEFAULT_OPTIONS,
        priority,
        jobId,
      });

      const estimatedWaitTime = await this.estimateWaitTime();

      this.logger.log(
        `Story generation queued: ${jobId} for user ${options.userId} [priority: ${priority}]`,
      );

      return { queued: true, jobId, estimatedWaitTime };
    } catch (error) {
      const errorMessage = ErrorHandler.extractMessage(error);
      this.logger.error(
        `Failed to queue story generation ${jobId}: ${errorMessage}`,
      );

      return {
        queued: false,
        jobId,
        error: errorMessage,
      };
    }
  }

  /**
   * Queue a personalized story generation for a specific kid
   */
  async queueStoryForKid(
    options: QueueStoryForKidOptions,
  ): Promise<QueuedStoryResult> {
    const jobId = uuidv4();

    try {
      const priority = options.priority ?? StoryPriority.NORMAL;

      const jobData: StoryJobData = {
        jobId,
        userId: options.userId,
        type: 'generate-for-kid',
        kidGeneration: {
          kidId: options.kidId,
          themes: options.themes,
          categories: options.categories,
          seasonIds: options.seasonIds,
          kidName: options.kidName,
        },
        metadata: {
          ...options.metadata,
          requestedAt: new Date(),
        },
      };

      await this.storyQueue.add(
        STORY_JOB_NAMES.GENERATE_STORY_FOR_KID,
        jobData,
        {
          ...STORY_QUEUE_DEFAULT_OPTIONS,
          priority,
          jobId,
        },
      );

      const estimatedWaitTime = await this.estimateWaitTime();

      this.logger.log(
        `Story generation for kid ${options.kidId} queued: ${jobId} [priority: ${priority}]`,
      );

      return { queued: true, jobId, estimatedWaitTime };
    } catch (error) {
      const errorMessage = ErrorHandler.extractMessage(error);
      this.logger.error(
        `Failed to queue story for kid ${jobId}: ${errorMessage}`,
      );

      return {
        queued: false,
        jobId,
        error: errorMessage,
      };
    }
  }

  /**
   * Get job status for client polling
   */
  async getJobStatus(jobId: string): Promise<StoryJobStatusResponse> {
    const job = await this.storyQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress =
      typeof job.progress === 'number'
        ? job.progress
        : ((job.progress as { percent?: number })?.percent ?? 0);

    let status: StoryJobStatus;
    let progressMessage: string | undefined;

    switch (state) {
      case 'waiting':
      case 'delayed':
        status = StoryJobStatus.QUEUED;
        progressMessage = 'Waiting in queue...';
        break;
      case 'active':
        status = this.getActiveStatus(progress);
        progressMessage = this.getProgressMessage(progress);
        break;
      case 'completed':
        status = StoryJobStatus.COMPLETED;
        progressMessage = 'Story generation complete!';
        break;
      case 'failed':
        status = StoryJobStatus.FAILED;
        progressMessage = 'Story generation failed';
        break;
      default:
        status = StoryJobStatus.QUEUED;
    }

    const response: StoryJobStatusResponse = {
      jobId,
      status,
      progress,
      progressMessage,
      createdAt: new Date(job.timestamp),
      startedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
    };

    // Include result if completed
    if (state === 'completed' && job.returnvalue) {
      const result = job.returnvalue;
      if (result.success && result.story) {
        response.result = result.story;
      }
    }

    // Include error if failed
    if (state === 'failed') {
      response.error = job.failedReason || 'Unknown error';
    }

    // Estimate remaining time for active jobs
    if (state === 'active' || state === 'waiting') {
      response.estimatedTimeRemaining = this.estimateRemainingTime(progress);
    }

    return response;
  }

  /**
   * Get the result of a completed job
   */
  async getJobResult(jobId: string): Promise<StoryJobResult | null> {
    const job = await this.storyQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();

    if (state !== 'completed') {
      return null;
    }

    return job.returnvalue;
  }

  /**
   * Cancel a pending job
   */
  async cancelJob(
    jobId: string,
    userId: string,
  ): Promise<{ cancelled: boolean; reason?: string }> {
    const job = await this.storyQueue.getJob(jobId);

    if (!job) {
      return { cancelled: false, reason: 'Job not found' };
    }

    // Verify ownership
    if (job.data.userId !== userId) {
      return { cancelled: false, reason: 'Unauthorized' };
    }

    const state = await job.getState();

    if (state === 'completed' || state === 'failed') {
      return { cancelled: false, reason: 'Job already finished' };
    }

    if (state === 'active') {
      return { cancelled: false, reason: 'Job already processing' };
    }

    await job.remove();
    this.logger.log(`Job ${jobId} cancelled by user ${userId}`);

    return { cancelled: true };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.storyQueue.getWaitingCount(),
      this.storyQueue.getActiveCount(),
      this.storyQueue.getCompletedCount(),
      this.storyQueue.getFailedCount(),
      this.storyQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get user's pending jobs
   */
  async getUserPendingJobs(userId: string): Promise<StoryJobStatusResponse[]> {
    const [waiting, active] = await Promise.all([
      this.storyQueue.getWaiting(),
      this.storyQueue.getActive(),
    ]);

    const userJobs = [...waiting, ...active].filter(
      (job) => job.data.userId === userId,
    );

    return Promise.all(
      userJobs.map((job) => this.getJobStatus(job.data.jobId)),
    );
  }

  /**
   * Pause the queue (for maintenance)
   */
  async pause(): Promise<void> {
    await this.storyQueue.pause();
    this.logger.warn('Story generation queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.storyQueue.resume();
    this.logger.log('Story generation queue resumed');
  }

  // --- Private helpers ---

  private getActiveStatus(progress: number): StoryJobStatus {
    if (progress < STORY_GENERATION_STAGES.GENERATING_CONTENT) {
      return StoryJobStatus.PROCESSING;
    } else if (progress < STORY_GENERATION_STAGES.GENERATING_IMAGE) {
      return StoryJobStatus.GENERATING_CONTENT;
    } else if (progress < STORY_GENERATION_STAGES.GENERATING_AUDIO) {
      return StoryJobStatus.GENERATING_IMAGE;
    } else if (progress < STORY_GENERATION_STAGES.PERSISTING) {
      return StoryJobStatus.GENERATING_AUDIO;
    } else {
      return StoryJobStatus.PERSISTING;
    }
  }

  private getProgressMessage(progress: number): string {
    if (progress < STORY_GENERATION_STAGES.GENERATING_CONTENT) {
      return 'Starting story generation...';
    } else if (progress < STORY_GENERATION_STAGES.GENERATING_IMAGE) {
      return 'Creating your story with AI...';
    } else if (progress < STORY_GENERATION_STAGES.GENERATING_AUDIO) {
      return 'Generating cover image...';
    } else if (progress < STORY_GENERATION_STAGES.PERSISTING) {
      return 'Recording narration...';
    } else {
      return 'Saving your story...';
    }
  }

  private estimateRemainingTime(progress: number): number {
    // Average story generation: ~35 seconds
    const totalEstimate = 35;
    const elapsed = (progress / 100) * totalEstimate;
    return Math.max(0, Math.ceil(totalEstimate - elapsed));
  }

  private async estimateWaitTime(): Promise<number> {
    const stats = await this.getQueueStats();
    // Estimate ~35 seconds per job, with concurrency of 2
    const avgTimePerJob = 35;
    const concurrency = 2;
    return Math.ceil((stats.waiting / concurrency) * avgTimePerJob);
  }
}
