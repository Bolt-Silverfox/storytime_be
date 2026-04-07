import { Injectable, Inject } from '@nestjs/common';
import {
  HttpHealthIndicator,
  HealthIndicatorResult,
  HealthIndicatorService,
  HealthCheck,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const indicator = this.healthIndicatorService.check(key);

    try {
      // Test connection with PING using the shared Redis client
      const pong = await this.redisClient.ping();

      // Get some Redis info
      const info = await this.redisClient.info('memory');
      const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
      const usedMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';

      const duration = Date.now() - startTime;

      return indicator.up({
        duration: `${duration}ms`,
        response: pong,
        usedMemory,
        status: this.redisClient.status,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return indicator.down({
        duration: `${duration}ms`,
        error: errorMessage,
        status: this.redisClient.status,
      });
    }
  }
}
