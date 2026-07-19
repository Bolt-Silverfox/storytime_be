import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * DI token for the notification module's dedicated ioredis client.
 *
 * Integration has no shared `RedisService` (it standardises on `@keyv/redis`
 * for caching + `ioredis` for BullMQ/queues), so — matching how the voice
 * module builds its raw ioredis client from REDIS_URL — the notification
 * scheduler gets its own thin ioredis connection purely for the distributed
 * cron lock (SET NX EX).
 */
export const NOTIFICATION_REDIS = Symbol('NOTIFICATION_REDIS');

export const NotificationRedisProvider: Provider = {
  provide: NOTIFICATION_REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    // Mirror integration's REDIS_URL convention (app.module / guest-session):
    // default to localhost rather than throwing, so app bootstrap (incl. e2e)
    // never fails on a missing URL. `lazyConnect` defers the socket until the
    // first lock command actually runs (i.e. when a cron fires), so this client
    // opens no connection during tests or if the scheduler never ticks.
    const redisUrl =
      config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    return new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  },
};
