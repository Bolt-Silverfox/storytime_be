// reports.module.ts
import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AchievementProgressModule } from '../achievement-progress/achievement-progress.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ScreenTimeService } from './services/screen-time.service';

@Module({
  imports: [PrismaModule, AchievementProgressModule],
  controllers: [ReportsController],
  providers: [ReportsService, ScreenTimeService],
  exports: [ReportsService, ScreenTimeService],
})
export class ReportsModule {}
