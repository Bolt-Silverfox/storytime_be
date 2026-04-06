import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import KeyvRedis from '@keyv/redis';
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
 * Shared Redis client provider using ioredis with reconnection logic
 */
export const RedisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: async (configService: ConfigService<EnvConfig, true>) => {
    const redisUrl = configService.get('REDIS_URL');

    // Parse Redis URL to extract connection details
    const url = new URL(redisUrl);
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
 * Shared KeyvRedis store provider for cache modules
 * Uses the shared Redis client to avoid multiple connections
 */
export const KeyvStoreProvider: Provider = {
  provide: KEYV_STORE,
  useFactory: async (redisClient: Redis) => {
    logger.log('Creating KeyvRedis store using shared Redis client');

    // KeyvRedis expects a node-redis client, but we can pass connection string
    // However, to reuse the connection, we need to use the same client
    // For now, we'll create a KeyvRedis with the URL and let it manage its own connection
    // In a future iteration, we could create a custom adapter
    const configService = new ConfigService<EnvConfig>();
    const redisUrl = configService.get('REDIS_URL');

    return new KeyvRedis(redisUrl);
  },
  inject: [REDIS_CLIENT],
};

export const redisProviders = [RedisClientProvider, KeyvStoreProvider];
