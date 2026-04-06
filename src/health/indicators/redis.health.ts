import { Injectable, Inject } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Test connection with PING using the shared Redis client
      const pong = await this.redisClient.ping();

      // Get some Redis info
      const info = await this.redisClient.info('memory');
      const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
      const usedMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';

      const duration = Date.now() - startTime;

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        response: pong,
        usedMemory,
        status: this.redisClient.status,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
          status: this.redisClient.status,
        }),
      );
    }
  }
}
