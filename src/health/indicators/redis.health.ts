import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { RedisService } from '@/redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redisService: RedisService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const indicator = this.healthIndicatorService.check(key);

    try {
      // Use RedisService.isReady() for standardized PING check
      const isReady = await this.redisService.isReady();

      if (!isReady) {
        const duration = Date.now() - startTime;
        return indicator.down({
          duration: `${duration}ms`,
          error: 'PING check failed',
          status: this.redisService.client.status,
        });
      }

      // Get some Redis info
      const info = await this.redisService.client.info('memory');
      const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
      const usedMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';

      const duration = Date.now() - startTime;

      return indicator.up({
        duration: `${duration}ms`,
        response: 'PONG',
        usedMemory,
        status: this.redisService.client.status,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return indicator.down({
        duration: `${duration}ms`,
        error: errorMessage,
        status: this.redisService.client.status,
      });
    }
  }
}
