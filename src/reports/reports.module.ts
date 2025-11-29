// reports.module.ts
import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AchievementProgressModule } from '../achievement-progress/achievement-progress.module';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService], // Export for use in other modules
  imports: [AchievementProgressModule],
})
export class ReportsModule { }
