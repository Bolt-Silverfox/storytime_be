/* eslint-disable @typescript-eslint/require-await */
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
import { AgeModule } from './age/age.module';
import { ReportsModule } from './reports/reports.module';
import { CacheModule } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import { CacheableMemory } from 'cacheable';
import KeyvRedis from '@keyv/redis';
import { KidModule } from './kid/kid.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => ({
        ttl: 4 * 60 * 60 * 1000, // 4 hours in milliseconds (for categories)
        stores: [
          // Primary: In-memory cache (fastest)
          new Keyv({
            store: new CacheableMemory({
              ttl: 4 * 60 * 60 * 1000,
              lruSize: 5000,
            }),
          }),
          // Secondary: Redis cache (persistent)
          new Keyv({
            store: new KeyvRedis(
              process.env.REDIS_URL || 'redis://localhost:6379',
            ),
          }),
        ],
      }),
    }),
    CommonModule,
    AuthModule,
    UserModule,
    KidModule,
    VoiceModule,
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
  ],
})
export class AppModule {}
