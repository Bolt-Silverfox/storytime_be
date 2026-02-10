import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@/auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { GeminiService } from './gemini.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { StoryProgressService } from './story-progress.service';
import { StoryRecommendationService } from './story-recommendation.service';
import { DailyChallengeService } from './daily-challenge.service';
import { StoryGenerationService } from './story-generation.service';
import { StoryQuotaService } from './story-quota.service';
import { VoiceModule } from '../voice/voice.module';
import { StoryAccessGuard } from '@/shared/guards/story-access.guard';
import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';
import { STORY_QUEUE_NAME, StoryQueueService, StoryProcessor } from './queue';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UploadModule,
    SubscriptionModule,
    forwardRef(() => VoiceModule),
    // Register story generation queue
    BullModule.registerQueue({
      name: STORY_QUEUE_NAME,
    }),
  ],
  controllers: [StoryController],
  providers: [
    StoryService,
    StoryProgressService,
    StoryRecommendationService,
    DailyChallengeService,
    StoryGenerationService,
    GeminiService,
    StoryQuotaService,
    StoryAccessGuard,
    SubscriptionThrottleGuard,
    // Queue components
    StoryQueueService,
    StoryProcessor,
  ],
  exports: [
    StoryService,
    StoryProgressService,
    StoryRecommendationService,
    DailyChallengeService,
    StoryGenerationService,
    StoryQuotaService,
    StoryQueueService,
  ]
})
export class StoryModule {}
