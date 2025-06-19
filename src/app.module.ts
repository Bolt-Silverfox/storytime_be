import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { SettingsModule } from './settings/settings.module';
import PrismaService from './prisma/prisma.service';
import { NotificationModule } from './notification/notification.module';
import { CloudinaryModule } from './upload/cloudinary.module';
import { UploadModule } from './upload/upload.module';
import { StoryModule } from './story/story.module';
import { RewardModule } from './reward/reward.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AuthModule,
    UserModule,
    SettingsModule,
    NotificationModule,
    CloudinaryModule,
    UploadModule,
    StoryModule,
    RewardModule,
    AnalyticsModule,
  ],
  providers: [PrismaService],
})
export class AppModule {}
