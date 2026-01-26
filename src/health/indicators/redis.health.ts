import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    let client: RedisClientType | null = null;

    try {
      const redisUrl = this.configService.get('REDIS_URL');

      client = createClient({ url: redisUrl });
      await client.connect();

      // Test connection with PING
      const pong = await client.ping();

      // Get some Redis info
      const info = await client.info('memory');
      const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
      const usedMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';

      await client.disconnect();

      const duration = Date.now() - startTime;

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        response: pong,
        usedMemory,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (client) {
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }

      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }
}
