import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { ActivityLogController } from './activity-log.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';
import {
  ANALYTICS_REPOSITORY,
  PrismaAnalyticsRepository,
} from './repositories';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AnalyticsController, ActivityLogController],
  providers: [
    AnalyticsService,
    {
      provide: ANALYTICS_REPOSITORY,
      useClass: PrismaAnalyticsRepository,
    },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
