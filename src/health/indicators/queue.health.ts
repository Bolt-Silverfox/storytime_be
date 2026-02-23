import { Injectable, Optional } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE_NAME } from '@/notification/queue/email-queue.constants';
import { STORY_QUEUE_NAME } from '@/story/queue/story-queue.constants';
import { VOICE_QUEUE_NAME } from '@/voice/queue/voice-queue.constants';

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

interface QueueHealthResult {
  duration: string;
  queues: Record<string, QueueStats>;
  totalWaiting: number;
  totalActive: number;
  totalFailed: number;
  unhealthyQueues: string[];
}

/**
 * Health indicator for BullMQ queues
 * Monitors email, story generation, and voice synthesis queues
 */
@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  private readonly queues: Map<string, Queue> = new Map();

  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME)
    private readonly emailQueue: Queue,
    @Optional()
    @InjectQueue(STORY_QUEUE_NAME)
    private readonly storyQueue: Queue | null,
    @Optional()
    @InjectQueue(VOICE_QUEUE_NAME)
    private readonly voiceQueue: Queue | null,
  ) {
    super();
    // Register available queues
    this.queues.set('email', this.emailQueue);
    if (this.storyQueue) {
      this.queues.set('story', this.storyQueue);
    }
    if (this.voiceQueue) {
      this.queues.set('voice', this.voiceQueue);
    }
  }

  /**
   * Check health of all queues
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      const queueStats = await this.getAllQueueStats();
      const duration = Date.now() - startTime;

      const unhealthyQueues = this.getUnhealthyQueues(queueStats);
      const isHealthy = unhealthyQueues.length === 0;

      const result: QueueHealthResult = {
        duration: `${duration}ms`,
        queues: Object.fromEntries(
          queueStats.map((q) => [q.name, q]),
        ) as Record<string, QueueStats>,
        totalWaiting: queueStats.reduce((sum, q) => sum + q.waiting, 0),
        totalActive: queueStats.reduce((sum, q) => sum + q.active, 0),
        totalFailed: queueStats.reduce((sum, q) => sum + q.failed, 0),
        unhealthyQueues,
      };

      if (!isHealthy) {
        throw new HealthCheckError(
          'One or more queues are unhealthy',
          this.getStatus(key, false, {
            ...result,
            reason: `Unhealthy queues: ${unhealthyQueues.join(', ')}`,
          }),
        );
      }

      return this.getStatus(key, true, result);
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const errorMessage =
        ErrorHandler.extractMessage(error);

      throw new HealthCheckError(
        'Queue health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }

  /**
   * Check health of a specific queue
   */
  async checkQueue(
    key: string,
    queueName: 'email' | 'story' | 'voice',
  ): Promise<HealthIndicatorResult> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return this.getStatus(key, false, {
        error: `Queue '${queueName}' not registered`,
      });
    }

    const startTime = Date.now();

    try {
      const stats = await this.getQueueStats(queueName, queue);
      const duration = Date.now() - startTime;
      const isHealthy = !stats.paused && stats.failed < 100;

      if (!isHealthy) {
        throw new HealthCheckError(
          `Queue '${queueName}' is unhealthy`,
          this.getStatus(key, false, {
            duration: `${duration}ms`,
            ...stats,
            reason: stats.paused ? 'Queue is paused' : 'Too many failed jobs',
          }),
        );
      }

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        ...stats,
      });
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const errorMessage =
        ErrorHandler.extractMessage(error);

      throw new HealthCheckError(
        `Queue '${queueName}' health check failed`,
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }

  private async getAllQueueStats(): Promise<QueueStats[]> {
    const stats: QueueStats[] = [];

    for (const [name, queue] of this.queues) {
      stats.push(await this.getQueueStats(name, queue));
    }

    return stats;
  }

  private async getQueueStats(name: string, queue: Queue): Promise<QueueStats> {
    const [waiting, active, completed, failed, delayed, paused] =
      await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ]);

    return { name, waiting, active, completed, failed, delayed, paused };
  }

  private getUnhealthyQueues(stats: QueueStats[]): string[] {
    return stats
      .filter((q) => q.paused || q.failed >= 100)
      .map((q) => q.name);
  }
}
