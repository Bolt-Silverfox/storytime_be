import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const TTS_BATCH_REDIS = Symbol('TTS_BATCH_REDIS');

export const TtsBatchRedisProvider: Provider = {
  provide: TTS_BATCH_REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not configured');
    }
    return new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
  },
};
