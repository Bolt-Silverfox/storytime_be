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
import { PrismaModule } from '../prisma/prisma.module';
import { TextToSpeechService } from './text-to-speech.service';
import { ElevenLabsService } from './elevenlabs.service';

// New Services
import { StoryFavoriteService } from './story-favorite.service';
import { StoryDownloadService } from './story-download.service';
import { StoryPathService } from './story-path.service';
import { StoryMetadataService } from './story-metadata.service';

// Repositories
import { STORY_CORE_REPOSITORY } from './repositories/story-core.repository.interface';
import { PrismaStoryCoreRepository } from './repositories/prisma-story-core.repository';
import { STORY_FAVORITE_REPOSITORY } from './repositories/story-favorite.repository.interface';
import { PrismaStoryFavoriteRepository } from './repositories/prisma-story-favorite.repository';
import { STORY_DOWNLOAD_REPOSITORY } from './repositories/story-download.repository.interface';
import { PrismaStoryDownloadRepository } from './repositories/prisma-story-download.repository';
import { STORY_PROGRESS_REPOSITORY } from './repositories/story-progress.repository.interface';
import { PrismaStoryProgressRepository } from './repositories/prisma-story-progress.repository';
import { STORY_PATH_REPOSITORY } from './repositories/story-path.repository.interface';
import { PrismaStoryPathRepository } from './repositories/prisma-story-path.repository';
import { STORY_METADATA_REPOSITORY } from './repositories/story-metadata.repository.interface';
import { PrismaStoryMetadataRepository } from './repositories/prisma-story-metadata.repository';
import { STORY_REPOSITORY } from './repositories/story.repository.interface';
import { PrismaStoryRepository } from './repositories/prisma-story.repository';
import { STORY_RECOMMENDATION_REPOSITORY } from './repositories/story-recommendation.repository.interface';
import { PrismaStoryRecommendationRepository } from './repositories/prisma-story-recommendation.repository';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UploadModule,
    SubscriptionModule,
    PrismaModule,
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
    TextToSpeechService,
    ElevenLabsService,
    StoryAccessGuard,
    SubscriptionThrottleGuard,
    StoryQueueService,
    StoryProcessor,

    // New Services
    StoryFavoriteService,
    StoryDownloadService,
    StoryPathService,
    StoryMetadataService,

    // Repositories
    {
      provide: STORY_CORE_REPOSITORY,
      useClass: PrismaStoryCoreRepository,
    },
    {
      provide: STORY_FAVORITE_REPOSITORY,
      useClass: PrismaStoryFavoriteRepository,
    },
    {
      provide: STORY_DOWNLOAD_REPOSITORY,
      useClass: PrismaStoryDownloadRepository,
    },
    {
      provide: STORY_PROGRESS_REPOSITORY,
      useClass: PrismaStoryProgressRepository,
    },
    {
      provide: STORY_PATH_REPOSITORY,
      useClass: PrismaStoryPathRepository,
    },
    {
      provide: STORY_METADATA_REPOSITORY,
      useClass: PrismaStoryMetadataRepository,
    },
    // Keep old repo for backward compatibility or strict migration
    {
      provide: STORY_REPOSITORY,
      useClass: PrismaStoryRepository,
    },
    {
      provide: STORY_RECOMMENDATION_REPOSITORY,
      useClass: PrismaStoryRecommendationRepository,
    },
  ],
  exports: [
    StoryService,
    StoryProgressService,
    StoryRecommendationService,
    DailyChallengeService,
    StoryGenerationService,
    StoryQuotaService,
    StoryFavoriteService,
    StoryDownloadService,
    StoryPathService,
    StoryMetadataService,
    StoryQueueService,
  ],
})
export class StoryModule { }
