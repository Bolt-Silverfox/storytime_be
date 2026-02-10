import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
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
} from './repositories';

@Module({
  imports: [PrismaModule, AuthModule, VoiceModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAnalyticsService,
    AdminUserService,
    AdminStoryService,
    {
      provide: ADMIN_STORY_REPOSITORY,
      useClass: PrismaAdminStoryRepository,
    },
    {
      provide: ADMIN_USER_REPOSITORY,
      useClass: PrismaAdminUserRepository,
    },
  ],
  exports: [
    AdminService,
    AdminAnalyticsService,
    AdminUserService,
    AdminStoryService,
  ],
})
export class AdminModule {}
