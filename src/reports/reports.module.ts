// reports.module.ts
import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { GeminiService } from '../story/gemini.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [ReportsController],
  providers: [ReportsService, GeminiService],
  exports: [ReportsService], // Export for use in other modules
})
export class ReportsModule {}

