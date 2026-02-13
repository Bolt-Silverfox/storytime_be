import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationCategory } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  PUSH_QUEUE_NAME,
  PUSH_JOB_NAMES,
  PUSH_QUEUE_DEFAULT_OPTIONS,
} from './push-queue.constants';
import {
  PushJobData,
  PushPriority,
  PUSH_CATEGORY_PRIORITY_MAP,
  PushTopicJobData,
} from './push-job.interface';

export interface QueuePushOptions {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: PushPriority;
  delay?: number;
  /** Optional: send to specific tokens instead of all user devices */
  tokens?: string[];
  android?: {
    channelId?: string;
    priority?: 'high' | 'normal';
  };
  ios?: {
    sound?: string;
    badge?: number;
  };
}

export interface QueuedPushResult {
  queued: boolean;
  jobId: string;
  error?: string;
}

/**
 * Push Queue Service
 * Provides methods to add push notification jobs to the queue
 */
@Injectable()
export class PushQueueService {
  private readonly logger = new Logger(PushQueueService.name);

  constructor(
    @InjectQueue(PUSH_QUEUE_NAME)
    private readonly pushQueue: Queue<PushJobData | PushTopicJobData>,
  ) {}

  /**
   * Add a push notification to the queue for async processing
   */
  async queuePush(options: QueuePushOptions): Promise<QueuedPushResult> {
    const jobId = uuidv4();

    try {
      const priority =
        options.priority ??
        PUSH_CATEGORY_PRIORITY_MAP[options.category] ??
        PushPriority.NORMAL;

      const jobData: PushJobData = {
        jobId,
        userId: options.userId,
        category: options.category,
        title: options.title,
        body: options.body,
        data: options.data,
        tokens: options.tokens,
        android: options.android,
        ios: options.ios,
      };

      await this.pushQueue.add(PUSH_JOB_NAMES.SEND_PUSH, jobData, {
        ...PUSH_QUEUE_DEFAULT_OPTIONS,
        priority,
        delay: options.delay,
        jobId,
      });

      this.logger.log(
        `Push notification queued: ${jobId} (${options.category}) for user ${options.userId} [priority: ${priority}]`,
      );

      return { queued: true, jobId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to queue push ${jobId}: ${errorMessage}`);

      return {
        queued: false,
        jobId,
        error: errorMessage,
      };
    }
  }

  /**
   * Queue a push notification to a topic (broadcast)
   */
  async queueTopicPush(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    delay?: number,
  ): Promise<QueuedPushResult> {
    const jobId = uuidv4();

    try {
      const jobData: PushTopicJobData = {
        jobId,
        topic,
        title,
        body,
        data,
      };

      await this.pushQueue.add(PUSH_JOB_NAMES.SEND_PUSH_TOPIC, jobData, {
        ...PUSH_QUEUE_DEFAULT_OPTIONS,
        priority: PushPriority.NORMAL,
        delay,
        jobId,
      });

      this.logger.log(`Topic push queued: ${jobId} to topic ${topic}`);

      return { queued: true, jobId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to queue topic push ${jobId}: ${errorMessage}`);

      return { queued: false, jobId, error: errorMessage };
    }
  }

  /**
   * Queue multiple push notifications (batch)
   */
  async queueBatch(
    notifications: QueuePushOptions[],
  ): Promise<QueuedPushResult[]> {
    const results = await Promise.all(
      notifications.map((notification) => this.queuePush(notification)),
    );

    const successful = results.filter((r) => r.queued).length;
    this.logger.log(
      `Batch queued: ${successful}/${notifications.length} push notifications`,
    );

    return results;
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
      this.pushQueue.getWaitingCount(),
      this.pushQueue.getActiveCount(),
      this.pushQueue.getCompletedCount(),
      this.pushQueue.getFailedCount(),
      this.pushQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get a specific job by ID
   */
  async getJob(jobId: string) {
    return this.pushQueue.getJob(jobId);
  }

  /**
   * Pause the queue (for maintenance)
   */
  async pause(): Promise<void> {
    await this.pushQueue.pause();
    this.logger.warn('Push queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.pushQueue.resume();
    this.logger.log('Push queue resumed');
  }
}
