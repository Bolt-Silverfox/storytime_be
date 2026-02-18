import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE_NAME } from '@/notification/queue/email-queue.constants';

@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME)
    private readonly emailQueue: Queue,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Get queue metrics
      const [waiting, active, completed, failed, delayed, paused] =
        await Promise.all([
          this.emailQueue.getWaitingCount(),
          this.emailQueue.getActiveCount(),
          this.emailQueue.getCompletedCount(),
          this.emailQueue.getFailedCount(),
          this.emailQueue.getDelayedCount(),
          this.emailQueue.isPaused(),
        ]);

      const duration = Date.now() - startTime;

      // Consider unhealthy if queue is paused or has too many failed jobs
      const isHealthy = !paused && failed < 100;

      if (!isHealthy) {
        throw new HealthCheckError(
          'Queue health check failed',
          this.getStatus(key, false, {
            duration: `${duration}ms`,
            paused,
            waiting,
            active,
            failed,
            reason: paused ? 'Queue is paused' : 'Too many failed jobs',
          }),
        );
      }

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        paused,
        waiting,
        active,
        completed,
        failed,
        delayed,
      });
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Queue health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }
}
