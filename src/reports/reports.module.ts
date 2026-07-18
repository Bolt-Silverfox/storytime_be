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
  STORY_QUESTION_REPOSITORY,
  PrismaStoryQuestionRepository,
  QUESTION_ANSWER_REPOSITORY,
  PrismaQuestionAnswerRepository,
  KID_REPOSITORY,
  PrismaKidRepository,
  STORY_PROGRESS_REPOSITORY,
  PrismaStoryProgressRepository,
  DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY,
  PrismaDailyChallengeAssignmentRepository,
  REWARD_REDEMPTION_REPOSITORY,
  PrismaRewardRedemptionRepository,
  FAVORITE_REPOSITORY,
  PrismaFavoriteRepository,
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
    {
      provide: STORY_QUESTION_REPOSITORY,
      useClass: PrismaStoryQuestionRepository,
    },
    {
      provide: QUESTION_ANSWER_REPOSITORY,
      useClass: PrismaQuestionAnswerRepository,
    },
    {
      provide: KID_REPOSITORY,
      useClass: PrismaKidRepository,
    },
    {
      provide: STORY_PROGRESS_REPOSITORY,
      useClass: PrismaStoryProgressRepository,
    },
    {
      provide: DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY,
      useClass: PrismaDailyChallengeAssignmentRepository,
    },
    {
      provide: REWARD_REDEMPTION_REPOSITORY,
      useClass: PrismaRewardRedemptionRepository,
    },
    {
      provide: FAVORITE_REPOSITORY,
      useClass: PrismaFavoriteRepository,
    },
  ],
  exports: [ReportsService, ScreenTimeService],
})
export class ReportsModule {}
