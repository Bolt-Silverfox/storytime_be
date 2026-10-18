import { Injectable } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService<EnvConfig,
    true>,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    let client: Redis | null = null;

    try {
      const redisUrl = this.configService.get('REDIS_URL');

      client = new Redis(redisUrl as string, {
        retryStrategy: () => null, // No reconnect attempts for health probe
        enableOfflineQueue: false,
        lazyConnect: true,
      });

      await client.connect();

      // Test connection with PING
      const pong = await client.ping();

      // Get some Redis info
      const info = await client.info('memory');
      const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
      const usedMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';

      const duration = Date.now() - startTime;

      return this.healthIndicatorService.check(key).up({
        duration: `${duration}ms`,
        response: pong,
        usedMemory,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = ErrorHandler.extractMessage(error);

      return this.healthIndicatorService.check(key).down({
          duration: `${duration}ms`,
          error: errorMessage,
        });
    } finally {
      if (client) {
        try {
          client.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
    }
  }
}
