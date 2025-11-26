import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgeModule } from './age/age.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { AvatarModule } from './avatar/avatar.module';
import { CommonModule } from './common/common.module';
import { validateEnv } from './config/env.validation';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { RewardModule } from './reward/reward.module';
import { SettingsModule } from './settings/settings.module';
import { StoryModule } from './story/story.module';
import { CloudinaryModule } from './upload/cloudinary.module';
import { UploadModule } from './upload/upload.module';
import { UserModule } from './user/user.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    CommonModule,
    AuthModule,
    UserModule,
    SettingsModule,
    NotificationModule,
    CloudinaryModule,
    UploadModule,
    StoryModule,
    RewardModule,
    AnalyticsModule,
    PrismaModule,
    AvatarModule,
    AgeModule,
    ReportsModule,
    VoiceModule,
  ],
})
export class AppModule {}
