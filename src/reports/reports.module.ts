// reports.module.ts
import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AchievementProgressModule } from '../achievement-progress/achievement-progress.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ScreenTimeService } from './services/screen-time.service';
import {
  SCREEN_TIME_REPOSITORY,
  PrismaScreenTimeRepository,
} from './repositories';

@Module({
  imports: [PrismaModule, AchievementProgressModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ScreenTimeService,
    {
      provide: SCREEN_TIME_REPOSITORY,
      useClass: PrismaScreenTimeRepository,
    },
  ],
  exports: [ReportsService, ScreenTimeService],
})
export class ReportsModule {}
