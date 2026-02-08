import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [PrismaModule, AuthModule, VoiceModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAnalyticsService],
  exports: [AdminService, AdminAnalyticsService],
})
export class AdminModule {}
