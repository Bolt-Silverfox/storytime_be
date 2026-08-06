import { Module, Global } from '@nestjs/common';
import { redisProviders } from './redis.provider';
import { RedisService } from './redis.service';

/**
 * Global Redis module that provides a shared Redis connection
 * to all modules in the application
 */
@Global()
@Module({
  providers: [...redisProviders, RedisService],
  exports: [...redisProviders, RedisService],
})
export class RedisModule {}
