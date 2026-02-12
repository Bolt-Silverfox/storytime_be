import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminUserService } from './admin-user.service';
import { AdminStoryService } from './admin-story.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import {
  ADMIN_STORY_REPOSITORY,
  PrismaAdminStoryRepository,
  ADMIN_USER_REPOSITORY,
  PrismaAdminUserRepository,
  ADMIN_ANALYTICS_REPOSITORY,
  PrismaAdminAnalyticsRepository,
  ADMIN_SYSTEM_REPOSITORY,
  PrismaAdminSystemRepository,
} from './repositories';
import { AdminSystemService } from './admin-system.service';

@Module({
  imports: [PrismaModule, AuthModule, VoiceModule],
  controllers: [AdminController],
  providers: [
    AdminAnalyticsService,
    AdminUserService,
    AdminStoryService,
    AdminSystemService,
    {
      provide: ADMIN_STORY_REPOSITORY,
      useClass: PrismaAdminStoryRepository,
    },
    {
      provide: ADMIN_USER_REPOSITORY,
      useClass: PrismaAdminUserRepository,
    },
    {
      provide: ADMIN_ANALYTICS_REPOSITORY,
      useClass: PrismaAdminAnalyticsRepository,
    },
    {
      provide: ADMIN_SYSTEM_REPOSITORY,
      useClass: PrismaAdminSystemRepository,
    },
  ],
  exports: [
    AdminAnalyticsService,
    AdminUserService,
    AdminStoryService,
    AdminSystemService,
    ADMIN_ANALYTICS_REPOSITORY,
  ],
})
export class AdminModule {}
