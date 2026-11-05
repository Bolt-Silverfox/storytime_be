import { Module } from '@nestjs/common';
import { SourceCacheService } from './source-cache.service';

/** Import where importers need the cache. PrismaModule is global. */
@Module({
  providers: [SourceCacheService],
  exports: [SourceCacheService],
})
export class SourceCacheModule {}
