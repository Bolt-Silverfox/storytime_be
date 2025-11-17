import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { NotificationModule } from './notification/notification.module';
import { PrismaService } from './prisma/prisma.service';
import { RewardModule } from './reward/reward.module';
import { SettingsModule } from './settings/settings.module';
import { StoryModule } from './story/story.module';
import { CloudinaryModule } from './upload/cloudinary.module';
import { UploadModule } from './upload/upload.module';
import { UserModule } from './user/user.module';

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
