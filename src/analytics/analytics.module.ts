import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { ActivityLogController } from './activity-log.controller';

@Module({
  controllers: [AnalyticsController, ActivityLogController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
