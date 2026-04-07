import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { EnvConfig } from '@/shared/config/env.validation';
import {
  REDIS_CLIENT,
  KEYV_STORE,
  REDIS_CONNECTION_TIMEOUT,
  REDIS_RECONNECT_DELAY,
  REDIS_MAX_RECONNECT_DELAY,
  REDIS_MAX_RECONNECT_ATTEMPTS,
} from './redis.constants';
import { Logger } from '@nestjs/common';

const logger = new Logger('RedisProvider');

/**
 * Custom Keyv store adapter for ioredis
 * This allows us to reuse the shared Redis connection for caching
 */
class IoredisStore {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.redis.get(key);
    if (value === null) {
      return undefined;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const stringValue = JSON.stringify(value);
    if (ttl) {
      await this.redis.setex(key, Math.ceil(ttl / 1000), stringValue);
    } else {
      await this.redis.set(key, stringValue);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.redis.del(key);
    return result > 0;
  }

  async clear(): Promise<void> {
    await this.redis.flushdb();
  }

  async has(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }
}

/**
 * Shared Redis client provider using ioredis with reconnection logic
 */
export const RedisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: async (configService: ConfigService<EnvConfig, true>) => {
    const redisUrl = configService.get('REDIS_URL');

    // Parse Redis URL to extract connection details
    let url: URL;
    try {
      url = new URL(redisUrl);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Failed to parse REDIS_URL: ${errorMessage}. URL: ${redisUrl}`,
      );
      throw new Error(
        `Invalid REDIS_URL format: ${errorMessage}. Please check your configuration.`,
      );
    }

    const password = url.password || undefined;
    const host = url.hostname || 'localhost';
    const port = parseInt(url.port || '6379', 10);

    logger.log(`Connecting to Redis at ${host}:${port}`);

    const client = new Redis({
      host,
      port,
      password,
      retryStrategy: (times: number) => {
        const delay = Math.min(
          REDIS_RECONNECT_DELAY * Math.pow(2, times),
          REDIS_MAX_RECONNECT_DELAY,
        );

        if (times > REDIS_MAX_RECONNECT_ATTEMPTS) {
          logger.error('Max Redis reconnection attempts reached');
          // Return null to stop reconnecting
          return null;
        }

        logger.warn(
          `Reconnecting to Redis (attempt ${times}), delay: ${delay}ms`,
        );
        return delay;
      },
      connectionName: 'storytime-shared',
      connectTimeout: REDIS_CONNECTION_TIMEOUT,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      // Keep the connection alive
      keepAlive: 10000,
      noDelay: true,
    });

    // Connection event handlers
    client.on('connect', () => {
      logger.log('Redis client connecting...');
    });

    client.on('ready', () => {
      logger.log('Redis client connected and ready');
    });

    client.on('error', (error) => {
      logger.error('Redis client error:', error.message);
    });

    client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    client.on('reconnecting', (delay: number) => {
      logger.log(`Redis reconnecting in ${delay}ms`);
    });

    client.on('end', () => {
      logger.warn('Redis connection ended');
    });

    // Test the connection
    try {
      await client.ping();
      logger.log('Redis connection test successful');
    } catch (error) {
      logger.error('Redis connection test failed:', error);
      throw error;
    }

    return client;
  },
  inject: [ConfigService],
};

/**
 * Shared Keyv store provider using the ioredis client
 * This enables caching to use the same Redis connection as BullMQ and health checks
 */
export const KeyvStoreProvider: Provider = {
  provide: KEYV_STORE,
  useFactory: async (redisClient: Redis) => {
    logger.log('Creating Keyv store using shared ioredis client');
    // Return our custom ioredis store adapter instead of KeyvRedis
    return new IoredisStore(redisClient) as unknown as Map<string, unknown>;
  },
  inject: [REDIS_CLIENT],
};

export const redisProviders = [RedisClientProvider, KeyvStoreProvider];
