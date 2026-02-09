import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@/auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { GeminiService } from './gemini.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { StoryProgressService } from './story-progress.service';
import { DailyChallengeService } from './daily-challenge.service';
import { StoryQuotaService } from './story-quota.service';
import { VoiceModule } from '../voice/voice.module';
import { StoryAccessGuard } from '@/shared/guards/story-access.guard';
import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UploadModule,
    SubscriptionModule,
    forwardRef(() => VoiceModule),
  ],
  controllers: [StoryController],
  providers: [
    StoryService,
    StoryProgressService,
    DailyChallengeService,
    GeminiService,
    StoryQuotaService,
    StoryAccessGuard,
    SubscriptionThrottleGuard,
  ],
  exports: [StoryService, StoryProgressService, DailyChallengeService, StoryQuotaService]
})
export class StoryModule {}
