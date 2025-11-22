import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationModule } from './notification/notification.module';
import { CloudinaryModule } from './upload/cloudinary.module';
import { UploadModule } from './upload/upload.module';
import { StoryModule } from './story/story.module';
import { RewardModule } from './reward/reward.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AvatarModule } from './avatar/avatar.module';
import { ReportsModule } from './reports/reports.module';

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
    ReportsModule,
  ],
})
export class AppModule {}
