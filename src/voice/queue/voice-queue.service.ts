import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { VoiceType } from '@/voice/dto/voice.dto';
import {
  VOICE_QUEUE_NAME,
  VOICE_JOB_NAMES,
  VOICE_QUEUE_DEFAULT_OPTIONS,
  VOICE_SYNTHESIS_STAGES,
  VOICE_SYNTHESIS_ESTIMATES,
} from './voice-queue.constants';
import {
  VoiceJobData,
  VoiceJobResult,
  VoiceJobStatus,
  VoiceJobStatusResponse,
  VoicePriority,
  VoiceQueueStats,
} from './voice-job.interface';

export interface QueueTextSynthesisOptions {
  userId: string;
  text: string;
  voiceType?: VoiceType;
  customVoiceId?: string;
  priority?: VoicePriority;
  metadata?: {
    clientIp?: string;
    userAgent?: string;
  };
}

export interface QueueStorySynthesisOptions {
  userId: string;
  storyId: string;
  voiceType?: VoiceType;
  customVoiceId?: string;
  updateStory?: boolean;
  priority?: VoicePriority;
  metadata?: {
    clientIp?: string;
    userAgent?: string;
  };
}

export interface QueuedVoiceResult {
  queued: boolean;
  jobId: string;
  estimatedWaitTime?: number;
  error?: string;
}

/**
 * Voice Queue Service
 * Provides methods to add voice synthesis jobs to the queue and check status
 */
@Injectable()
export class VoiceQueueService {
  private readonly logger = new Logger(VoiceQueueService.name);

  constructor(
    @InjectQueue(VOICE_QUEUE_NAME)
    private readonly voiceQueue: Queue<VoiceJobData, VoiceJobResult>,
  ) {}

  /**
   * Queue a text-to-speech synthesis job
   */
  async queueTextSynthesis(
    options: QueueTextSynthesisOptions,
  ): Promise<QueuedVoiceResult> {
    const jobId = uuidv4();

    try {
      const priority = options.priority ?? VoicePriority.NORMAL;

      const jobData: VoiceJobData = {
        jobId,
        userId: options.userId,
        type: 'synthesize-text',
        textSynthesis: {
          text: options.text,
          voiceType: options.voiceType,
          customVoiceId: options.customVoiceId,
        },
        metadata: {
          ...options.metadata,
          requestedAt: new Date(),
          textLength: options.text.length,
        },
      };

      await this.voiceQueue.add(VOICE_JOB_NAMES.SYNTHESIZE_TEXT, jobData, {
        ...VOICE_QUEUE_DEFAULT_OPTIONS,
        priority,
        jobId,
      });

      const estimatedWaitTime = await this.estimateWaitTime(
        options.text.length,
      );

      this.logger.log(
        `Text synthesis queued: ${jobId} for user ${options.userId} [priority: ${priority}, chars: ${options.text.length}]`,
      );

      return { queued: true, jobId, estimatedWaitTime };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to queue text synthesis ${jobId}: ${errorMessage}`,
      );

      return {
        queued: false,
        jobId,
        error: errorMessage,
      };
    }
  }

  /**
   * Queue a story audio synthesis job
   */
  async queueStorySynthesis(
    options: QueueStorySynthesisOptions,
  ): Promise<QueuedVoiceResult> {
    const jobId = uuidv4();

    try {
      const priority = options.priority ?? VoicePriority.NORMAL;

      const jobData: VoiceJobData = {
        jobId,
        userId: options.userId,
        type: 'synthesize-story',
        storySynthesis: {
          storyId: options.storyId,
          voiceType: options.voiceType,
          customVoiceId: options.customVoiceId,
          updateStory: options.updateStory ?? false,
        },
        metadata: {
          ...options.metadata,
          requestedAt: new Date(),
        },
      };

      await this.voiceQueue.add(VOICE_JOB_NAMES.SYNTHESIZE_STORY, jobData, {
        ...VOICE_QUEUE_DEFAULT_OPTIONS,
        priority,
        jobId,
      });

      const estimatedWaitTime = await this.estimateWaitTime();

      this.logger.log(
        `Story synthesis queued: ${jobId} for story ${options.storyId} [priority: ${priority}]`,
      );

      return { queued: true, jobId, estimatedWaitTime };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to queue story synthesis ${jobId}: ${errorMessage}`,
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
  async getJobStatus(jobId: string): Promise<VoiceJobStatusResponse> {
    const job = await this.voiceQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress =
      typeof job.progress === 'number'
        ? job.progress
        : ((job.progress as { percent?: number })?.percent ?? 0);

    let status: VoiceJobStatus;
    let progressMessage: string | undefined;

    switch (state) {
      case 'waiting':
      case 'delayed':
        status = VoiceJobStatus.QUEUED;
        progressMessage = 'Waiting in queue...';
        break;
      case 'active':
        status = this.getActiveStatus(progress);
        progressMessage = this.getProgressMessage(progress);
        break;
      case 'completed':
        status = VoiceJobStatus.COMPLETED;
        progressMessage = 'Audio generation complete!';
        break;
      case 'failed':
        status = VoiceJobStatus.FAILED;
        progressMessage = 'Audio generation failed';
        break;
      default:
        status = VoiceJobStatus.QUEUED;
    }

    const response: VoiceJobStatusResponse = {
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
      if (result.success && result.audioUrl) {
        response.result = {
          audioUrl: result.audioUrl,
          durationSeconds: result.durationSeconds,
        };
      }
    }

    // Include error if failed
    if (state === 'failed') {
      response.error = job.failedReason || 'Unknown error';
    }

    // Estimate remaining time for active jobs
    if (state === 'active' || state === 'waiting') {
      const textLength = job.data.metadata?.textLength;
      response.estimatedTimeRemaining = this.estimateRemainingTime(
        progress,
        textLength,
      );
    }

    return response;
  }

  /**
   * Get the result of a completed job
   */
  async getJobResult(jobId: string): Promise<VoiceJobResult | null> {
    const job = await this.voiceQueue.getJob(jobId);

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
    const job = await this.voiceQueue.getJob(jobId);

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
  async getQueueStats(): Promise<VoiceQueueStats> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.voiceQueue.getWaitingCount(),
      this.voiceQueue.getActiveCount(),
      this.voiceQueue.getCompletedCount(),
      this.voiceQueue.getFailedCount(),
      this.voiceQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get user's pending jobs
   */
  async getUserPendingJobs(userId: string): Promise<VoiceJobStatusResponse[]> {
    const [waiting, active] = await Promise.all([
      this.voiceQueue.getWaiting(),
      this.voiceQueue.getActive(),
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
    await this.voiceQueue.pause();
    this.logger.warn('Voice synthesis queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.voiceQueue.resume();
    this.logger.log('Voice synthesis queue resumed');
  }

  // --- Private helpers ---

  private getActiveStatus(progress: number): VoiceJobStatus {
    if (progress < VOICE_SYNTHESIS_STAGES.SYNTHESIZING) {
      return VoiceJobStatus.PROCESSING;
    } else if (progress < VOICE_SYNTHESIS_STAGES.UPLOADING) {
      return VoiceJobStatus.SYNTHESIZING;
    } else {
      return VoiceJobStatus.UPLOADING;
    }
  }

  private getProgressMessage(progress: number): string {
    if (progress < VOICE_SYNTHESIS_STAGES.SYNTHESIZING) {
      return 'Preparing voice synthesis...';
    } else if (progress < VOICE_SYNTHESIS_STAGES.UPLOADING) {
      return 'Generating audio with AI voice...';
    } else {
      return 'Uploading audio file...';
    }
  }

  private estimateRemainingTime(progress: number, textLength?: number): number {
    // Estimate total time based on text length
    let totalEstimate: number = VOICE_SYNTHESIS_ESTIMATES.MIN_TIME;

    if (textLength) {
      const charBasedEstimate =
        (textLength / 1000) * VOICE_SYNTHESIS_ESTIMATES.PER_1000_CHARS +
        VOICE_SYNTHESIS_ESTIMATES.UPLOAD_OVERHEAD;

      totalEstimate = Math.min(
        Math.max(charBasedEstimate, VOICE_SYNTHESIS_ESTIMATES.MIN_TIME),
        VOICE_SYNTHESIS_ESTIMATES.MAX_TIME,
      );
    } else {
      // Default estimate for story synthesis (unknown length)
      totalEstimate = 15;
    }

    const elapsed = (progress / 100) * totalEstimate;
    return Math.max(0, Math.ceil(totalEstimate - elapsed));
  }

  private async estimateWaitTime(textLength?: number): Promise<number> {
    const stats = await this.getQueueStats();

    // Estimate per-job time
    let avgTimePerJob = 10; // Default 10 seconds
    if (textLength) {
      avgTimePerJob =
        (textLength / 1000) * VOICE_SYNTHESIS_ESTIMATES.PER_1000_CHARS +
        VOICE_SYNTHESIS_ESTIMATES.UPLOAD_OVERHEAD;
    }

    // With concurrency of 3
    const concurrency = 3;
    return Math.ceil((stats.waiting / concurrency) * avgTimePerJob);
  }
}
