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
import { EventEmitter } from 'events';
import type { KeyvStoreAdapter, StoredData } from 'keyv';

const logger = new Logger('RedisProvider');

/**
 * Custom Keyv store adapter for ioredis
 * This allows us to reuse the shared Redis connection for caching
 */
class IoredisStore extends EventEmitter implements KeyvStoreAdapter {
  // Required by KeyvStoreAdapter interface
  public opts: any = {};
  // Bumped from 'cache:' to invalidate legacy double-wrapped entries
  // written by the previous IoredisStore implementation.
  private readonly cachePrefix = 'cache:v2:';

  constructor(private readonly redis: Redis) {
    super();
  }

  async get<Value>(key: string): Promise<StoredData<Value>> {
    const fullKey = this.cachePrefix + key;
    const value = await this.redis.get(fullKey);

    if (value === null) {
      return undefined;
    }

    // Keyv handles serialization/deserialization itself, wrapping values in
    // a {value, expires} envelope. Return the raw stored string and let Keyv
    // deserialize. Wrapping/unwrapping here would double-serialize the data.
    // Note: at runtime this is a JSON string; Keyv accepts string | object.
    return value as unknown as StoredData<Value>;
  }

  async set<Value>(key: string, value: Value, ttl?: number): Promise<boolean> {
    const fullKey = this.cachePrefix + key;
    // Keyv has already serialized `value` into a JSON string of the form
    // {value, expires}. Persist it as-is to avoid double-wrapping.
    const payload = value as unknown as string;

    if (ttl !== undefined) {
      await this.redis.set(fullKey, payload, 'PX', ttl);
    } else {
      await this.redis.set(fullKey, payload);
    }

    return true;
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.redis.del(this.cachePrefix + key);
    return result > 0;
  }

  async clear(): Promise<void> {
    // Delete only cache keys, not all Redis data
    // Use SCAN to find keys matching the cache prefix and delete in batches
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.cachePrefix}*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        // Use UNLINK for non-blocking deletion
        await this.redis.unlink(...keys);
      }
    } while (cursor !== '0');
  }

  async has(key: string): Promise<boolean> {
    const result = await this.redis.exists(this.cachePrefix + key);
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

    // Guard up front: a non-string/empty REDIS_URL would make the redaction
    // (`redisUrl.replace(...)`) in the catch/validation branches below throw a
    // TypeError and mask the real "Invalid REDIS_URL" diagnostic.
    if (typeof redisUrl !== 'string' || redisUrl.length === 0) {
      logger.error('REDIS_URL is not set or is not a string.');
      throw new Error(
        'Invalid REDIS_URL: must be a non-empty string. Please check your configuration.',
      );
    }

    // Parse Redis URL to extract connection details
    let url: URL;
    try {
      url = new URL(redisUrl);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      // Log redacted URL (remove credentials) to avoid exposing secrets
      const redactedUrl = redisUrl.replace(/:[^:@]+@/, ':***@');
      logger.error(
        `Failed to parse REDIS_URL: ${errorMessage}. URL: ${redactedUrl}`,
      );
      throw new Error(
        `Invalid REDIS_URL format: ${errorMessage}. Please check your configuration.`,
      );
    }

    // Validate protocol
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      const redactedUrl = redisUrl.replace(/:[^:@]+@/, ':***@');
      logger.error(
        `Invalid Redis protocol: ${url.protocol}. Must be "redis:" or "rediss:". URL: ${redactedUrl}`,
      );
      throw new Error(
        `Invalid REDIS_URL protocol. Must be "redis:" or "rediss:" (for TLS).`,
      );
    }

    // Validate and parse database number
    let db: number;
    if (url.pathname && url.pathname !== '/') {
      const dbPath = url.pathname.slice(1);

      // Validate path is strictly digits (e.g., "0", "15", not "1/foo" or "abc")
      if (!/^\d+$/.test(dbPath)) {
        const redactedUrl = redisUrl.replace(/:[^:@]+@/, ':***@');
        logger.error(
          `Invalid Redis database number: ${url.pathname}. Must be a non-negative integer. URL: ${redactedUrl}`,
        );
        throw new Error(
          `Invalid REDIS_URL database number. Must be a non-negative integer.`,
        );
      }

      const dbNum = Number.parseInt(dbPath, 10);
      db = dbNum;
    } else {
      db = 0;
    }

    // WHATWG URL exposes username/password percent-encoded; decode so
    // credentials containing reserved chars (@ : / % ...) authenticate with
    // their real value rather than the encoded form.
    const username = url.username
      ? decodeURIComponent(url.username)
      : undefined;
    const password = url.password
      ? decodeURIComponent(url.password)
      : undefined;
    const host = url.hostname || 'localhost';
    const port = parseInt(url.port || '6379', 10);

    // Check for TLS (rediss:// protocol)
    const tls = url.protocol === 'rediss:' ? {} : undefined;

    logger.log(`Connecting to Redis at ${host}:${port}`);

    const client = new Redis({
      host,
      port,
      username,
      password,
      db,
      tls,
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
      connectionName: `storytime-${process.env.NODE_ENV || 'development'}`,
      connectTimeout: REDIS_CONNECTION_TIMEOUT,
      enableReadyCheck: true,
      maxRetriesPerRequest: null,
      // Enable offline queue to buffer commands when connection is lost
      enableOfflineQueue: true,
      // Ensure connection on startup
      lazyConnect: false,
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
      // Categorize errors to prevent uncaught exceptions
      // Connection errors are handled by retryStrategy, so just warn
      if (
        error.name === 'SocketClosedUnexpectedlyError' ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEOUT') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('EAI_AGAIN')
      ) {
        logger.warn('Redis connection error (will retry):', error.message);
        return;
      }

      // Log critical errors that need investigation
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
      stopKeepAlive();
    });

    // Local Redis uses the default `timeout 300` (5 min); TCP-level
    // keepAlive alone doesn't reset the idle timer on most servers. Send
    // a Redis-protocol PING every 30 s so the server counts it as activity.
    // ioredis 5.10 doesn't expose a `pingInterval` option, so we run a
    // guard-checked setInterval on the client ourselves.
    const pingIntervalMs = 30000;
    let pingTimer: NodeJS.Timeout | null = null;
    const stopKeepAlive = (): void => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };
    const startKeepAlive = (): void => {
      stopKeepAlive();
      pingTimer = setInterval(() => {
        // Only ping when the client is in a usable state. Failures are
        // tolerated — the existing error/reconnecting handlers cover
        // reconnect cycles and the next tick will retry.
        if (client.status === 'ready') {
          client.ping().catch(() => undefined);
        }
      }, pingIntervalMs);
      // Don't keep the event loop alive just for this ping.
      pingTimer.unref?.();
    };
    startKeepAlive();
    client.on('ready', startKeepAlive);

    // Test the connection
    try {
      await client.ping();
      logger.log('Redis connection test successful');
    } catch (error) {
      // Stop the keepalive timer before disconnecting. We can't rely on the
      // 'end' event from disconnect() to clean up the timer — it fires
      // asynchronously and we want to drop the setInterval synchronously so the
      // failed provider factory doesn't leave a timer scheduled against a
      // disposed client.
      stopKeepAlive();
      // Disconnect client to stop retry/reconnection attempts before propagating error
      try {
        client.disconnect();
      } catch (disconnectError) {
        logger.error('Error during Redis client shutdown:', disconnectError);
      }
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
  useFactory: (redisClient: Redis) => {
    logger.log('Creating Keyv store using shared ioredis client');
    // Cast is safe: IoredisStore implements KeyvStoreAdapter interface
    // which Keyv uses for tiered caching. Exposing as Map<string, unknown>
    // for KEYV_STORE token allows Keyv to use our custom adapter.
    return new IoredisStore(redisClient) as unknown as Map<string, unknown>;
  },
  inject: [REDIS_CLIENT],
};

export const redisProviders = [RedisClientProvider, KeyvStoreProvider];
