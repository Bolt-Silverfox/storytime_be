import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { StreakService } from './streak.service';
import { BadgeService } from './badge.service';
import { BadgeProgressEngine } from './badge-progress.engine';
import { BadgeConstants } from './badge.constants';
import { NotificationModule } from '../notification/notification.module';
import {
  STREAK_REPOSITORY,
  PrismaStreakRepository,
  BADGE_REPOSITORY,
  PrismaBadgeRepository,
  USER_BADGE_REPOSITORY,
  PrismaUserBadgeRepository,
  KID_REPOSITORY,
  PrismaKidRepository,
  STORY_PROGRESS_REPOSITORY,
  PrismaStoryProgressRepository,
  DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY,
  PrismaDailyChallengeAssignmentRepository,
  SCREEN_TIME_SESSION_REPOSITORY,
  PrismaScreenTimeSessionRepository,
} from './repositories';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300, // 5 minutes default TTL
      max: 100, // Max items in cache
    }),
    // EventEmitterModule is now globally registered in AppModule
    NotificationModule,
  ],
  controllers: [ProgressController],
  providers: [
    ProgressService,
    StreakService,
    BadgeService,
    BadgeProgressEngine,
    BadgeConstants,
    {
      provide: STREAK_REPOSITORY,
      useClass: PrismaStreakRepository,
    },
    {
      provide: BADGE_REPOSITORY,
      useClass: PrismaBadgeRepository,
    },
    {
      provide: USER_BADGE_REPOSITORY,
      useClass: PrismaUserBadgeRepository,
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
      provide: SCREEN_TIME_SESSION_REPOSITORY,
      useClass: PrismaScreenTimeSessionRepository,
    },
  ],
  exports: [BadgeProgressEngine, BadgeService],
})
export class AchievementProgressModule {}
