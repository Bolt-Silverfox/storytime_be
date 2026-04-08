import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { Logger } from '@nestjs/common';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  /**
 * Check if Redis connection is ready
 * Used by health checks and monitoring
 */
 async isReady(): Promise<boolean> {
 try {
 const pong = await this.client.ping();
 return pong === 'PONG';
 } catch (error) {
 this.logger.error('Redis health check failed:', error instanceof Error ? error.message : 'Unknown error');
 return false;
 }
 }

 async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down Redis connection...');

    try {
      // Try graceful quit first
      await this.client.quit();
      this.logger.log('Redis connection closed gracefully');
    } catch (error) {
      // Fallback to disconnect on error
      this.logger.warn(
        `Graceful Redis shutdown failed, using disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      try {
        this.client.disconnect();
      } catch (disconnectError) {
        this.logger.error(
          `Error during Redis disconnect: ${disconnectError instanceof Error ? disconnectError.message : 'Unknown error'}`,
        );
      }
    }
  }
}
