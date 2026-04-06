import { Module, Global } from '@nestjs/common';
import { redisProviders } from './redis.provider';

/**
 * Global Redis module that provides a shared Redis connection
 * to all modules in the application
 */
@Global()
@Module({
  providers: [...redisProviders],
  exports: [...redisProviders],
})
export class RedisModule {}
