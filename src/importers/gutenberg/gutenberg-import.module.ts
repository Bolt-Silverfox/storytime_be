import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { SourceCacheModule } from '@/source-cache/source-cache.module';

/** Standalone context for the CLI only. Not imported by AppModule: no HTTP surface. */
@Module({ imports: [PrismaModule, SourceCacheModule] })
export class GutenbergImportModule {}
