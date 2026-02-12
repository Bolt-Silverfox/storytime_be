import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PUSH_QUEUE_NAME, PUSH_JOB_NAMES } from './push-queue.constants';
import {
  PushJobData,
  PushJobResult,
  PushTopicJobData,
} from './push-job.interface';
import { PushProvider } from '../providers/push.provider';

/**
 * Push Queue Processor
 * Handles push notification sending jobs with retry support
 */
@Processor(PUSH_QUEUE_NAME, { concurrency: 20 })
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger(PushProcessor.name);

  constructor(private readonly pushProvider: PushProvider) {
    super();
  }

  /**
   * Process push notification job
   * This method is called by BullMQ for each job
   */
  async process(
    job: Job<PushJobData | PushTopicJobData>,
  ): Promise<PushJobResult> {
    const attemptsMade = job.attemptsMade + 1;

    // Handle topic push
    if (job.name === PUSH_JOB_NAMES.SEND_PUSH_TOPIC) {
      return this.processTopicPush(job as Job<PushTopicJobData>, attemptsMade);
    }

    // Handle regular push
    return this.processUserPush(job as Job<PushJobData>, attemptsMade);
  }

  private async processUserPush(
    job: Job<PushJobData>,
    attemptsMade: number,
  ): Promise<PushJobResult> {
    const { userId, category, title, body, data, tokens, jobId } = job.data;

    this.logger.log(
      `Processing push job ${jobId} (attempt ${attemptsMade}): ${category} for user ${userId}`,
    );

    try {
      let result;

      if (tokens && tokens.length > 0) {
        // Send to specific tokens
        result = await this.pushProvider.sendToTokens(tokens, title, body, data);
      } else {
        // Send via notification payload (user lookup)
        result = await this.pushProvider.send({
          userId,
          category,
          title,
          body,
          data,
        });
      }

      if (!result.success) {
        throw new Error(result.error || 'Push notification failed');
      }

      this.logger.log(
        `Push sent successfully: ${jobId} -> user ${userId} (${result.messageId})`,
      );

      return {
        success: true,
        successCount: 1,
        failureCount: 0,
        messageId: result.messageId,
        attemptsMade,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Push job ${jobId} failed (attempt ${attemptsMade}): ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Throw to trigger retry
      throw new Error(`Failed to send push to user ${userId}: ${errorMessage}`);
    }
  }

  private async processTopicPush(
    job: Job<PushTopicJobData>,
    attemptsMade: number,
  ): Promise<PushJobResult> {
    const { topic, title, body, data, jobId } = job.data;

    this.logger.log(
      `Processing topic push job ${jobId} (attempt ${attemptsMade}): topic ${topic}`,
    );

    try {
      const result = await this.pushProvider.sendToTopic(topic, title, body, data);

      if (!result.success) {
        throw new Error(result.error || 'Topic push failed');
      }

      this.logger.log(
        `Topic push sent successfully: ${jobId} -> topic ${topic} (${result.messageId})`,
      );

      return {
        success: true,
        successCount: 1,
        failureCount: 0,
        messageId: result.messageId,
        attemptsMade,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Topic push job ${jobId} failed (attempt ${attemptsMade}): ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new Error(`Failed to send push to topic ${topic}: ${errorMessage}`);
    }
  }

  /**
   * Called when a job completes successfully
   */
  @OnWorkerEvent('completed')
  onCompleted(
    job: Job<PushJobData | PushTopicJobData>,
    result: PushJobResult,
  ): void {
    const jobId =
      'jobId' in job.data ? job.data.jobId : (job.data as PushTopicJobData).jobId;

    this.logger.log(
      `Job ${jobId} completed (attempts: ${result.attemptsMade}, messageId: ${result.messageId})`,
    );
  }

  /**
   * Called when a job fails (before retry)
   */
  @OnWorkerEvent('failed')
  onFailed(
    job: Job<PushJobData | PushTopicJobData> | undefined,
    error: Error,
  ): void {
    if (!job) {
      this.logger.error('Push job failed with no job data', error.stack);
      return;
    }

    const jobId =
      'jobId' in job.data ? job.data.jobId : (job.data as PushTopicJobData).jobId;
    const willRetry = job.attemptsMade < (job.opts.attempts || 0);

    if (willRetry) {
      this.logger.warn(
        `Job ${jobId} failed (attempt ${job.attemptsMade}), will retry: ${error.message}`,
      );
    } else {
      this.logger.error(
        `Job ${jobId} permanently failed after ${job.attemptsMade} attempts: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Called when worker becomes active
   */
  @OnWorkerEvent('active')
  onActive(job: Job<PushJobData | PushTopicJobData>): void {
    const jobId =
      'jobId' in job.data ? job.data.jobId : (job.data as PushTopicJobData).jobId;
    this.logger.debug(`Processing job ${jobId}`);
  }

  /**
   * Called when worker encounters an error
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error('Push worker error:', error.stack);
  }
}
