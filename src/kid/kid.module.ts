import { Module } from '@nestjs/common';
import { KidController } from './kid.controller';
import { KidService } from './kid.service';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { AnalyticsModule } from '@/analytics/analytics.module';

@Module({
  imports: [AuthModule, VoiceModule, AnalyticsModule],
  controllers: [KidController],
  providers: [KidService],
  exports: [KidService],
})
export class KidModule {}
