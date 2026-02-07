import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationCategory } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  EMAIL_QUEUE_NAME,
  EMAIL_JOB_NAMES,
  EMAIL_QUEUE_DEFAULT_OPTIONS,
} from './email-queue.constants';
import {
  EmailJobData,
  EmailPriority,
  CATEGORY_PRIORITY_MAP,
} from './email-job.interface';

export interface QueueEmailOptions {
  userId: string;
  category: NotificationCategory;
  to: string;
  subject: string;
  html: string;
  priority?: EmailPriority;
  delay?: number;
  metadata?: {
    templateName?: string;
    originalData?: Record<string, unknown>;
  };
}

export interface QueuedEmailResult {
  queued: boolean;
  jobId: string;
  error?: string;
}

/**
 * Email Queue Service
 * Provides methods to add email jobs to the queue
 */
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME)
    private readonly emailQueue: Queue<EmailJobData>,
  ) {}

  /**
   * Add an email to the queue for async processing
   */
  async queueEmail(options: QueueEmailOptions): Promise<QueuedEmailResult> {
    const jobId = uuidv4();

    try {
      const priority =
        options.priority ??
        CATEGORY_PRIORITY_MAP[options.category] ??
        EmailPriority.NORMAL;

      const jobData: EmailJobData = {
        jobId,
        userId: options.userId,
        category: options.category,
        to: options.to,
        subject: options.subject,
        html: options.html,
        metadata: options.metadata,
      };

      await this.emailQueue.add(EMAIL_JOB_NAMES.SEND_EMAIL, jobData, {
        ...EMAIL_QUEUE_DEFAULT_OPTIONS,
        priority,
        delay: options.delay,
        jobId, // Use our generated ID for tracking
      });

      this.logger.log(
        `Email queued: ${jobId} (${options.category}) to ${options.to} [priority: ${priority}]`,
      );

      return { queued: true, jobId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to queue email ${jobId}: ${errorMessage}`);

      return {
        queued: false,
        jobId,
        error: errorMessage,
      };
    }
  }

  /**
   * Queue multiple emails (batch)
   */
  async queueBatch(emails: QueueEmailOptions[]): Promise<QueuedEmailResult[]> {
    const results = await Promise.all(
      emails.map((email) => this.queueEmail(email)),
    );

    const successful = results.filter((r) => r.queued).length;
    this.logger.log(`Batch queued: ${successful}/${emails.length} emails`);

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
      this.emailQueue.getWaitingCount(),
      this.emailQueue.getActiveCount(),
      this.emailQueue.getCompletedCount(),
      this.emailQueue.getFailedCount(),
      this.emailQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get a specific job by ID
   */
  async getJob(jobId: string) {
    return this.emailQueue.getJob(jobId);
  }

  /**
   * Pause the queue (for maintenance)
   */
  async pause(): Promise<void> {
    await this.emailQueue.pause();
    this.logger.warn('Email queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.emailQueue.resume();
    this.logger.log('Email queue resumed');
  }

  /**
   * Drain the queue (remove all waiting jobs)
   * Use with caution!
   */
  async drain(): Promise<void> {
    await this.emailQueue.drain();
    this.logger.warn('Email queue drained');
  }
}
