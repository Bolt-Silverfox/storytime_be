/* eslint-disable @typescript-eslint/require-await */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AgeModule } from './age/age.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { AvatarModule } from './avatar/avatar.module';
import { SharedModule } from './shared/shared.module';
import { validateEnv, EnvConfig } from './shared/config/env.validation';
import { HelpSupportModule } from './help-support/help-support.module';
import { KidModule } from './kid/kid.module';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { CacheModule } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import { CacheableMemory } from 'cacheable';
import KeyvRedis from '@keyv/redis';

import { RewardModule } from './reward/reward.module';
import { SettingsModule } from './settings/settings.module';
import { StoryBuddyModule } from './story-buddy/story-buddy.module';
import { StoryModule } from './story/story.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { CloudinaryModule } from './upload/cloudinary.module';
import { UploadModule } from './upload/upload.module';
import { UserModule } from './user/user.module';
import { VoiceModule } from './voice/voice.module';
import { PaymentModule } from './payment/payment.module';
import { AchievementProgressModule } from './achievement-progress/achievement-progress.module';
import { ParentFavoriteModule } from './parent-favorites/parent-favorites.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import {
  throttleConfig,
  ThrottlerConfig,
} from './shared/config/throttle.config';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { BullBoardConfigModule } from './admin/bull-board.module';

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
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = (
          config.get<string>('NODE_ENV') ?? 'production'
        ).toLowerCase();
        const nonProdEnvs = ['development', 'staging', 'test', 'local'];
        const isNonProd = nonProdEnvs.includes(nodeEnv);

        // Only relax rate limits for explicit non-prod environments
        // Unknown or missing NODE_ENV defaults to strict (production) limits
        const multiplier = isNonProd ? 100 : 1;

        return {
          throttlers: throttleConfig.throttlers.map((t: ThrottlerConfig) => ({
            ...t,
            limit: t.limit * multiplier,
          })),
        };
      },
    }),
    // BullMQ for background job processing (email queue, etc.)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        connection: {
          url: config.get('REDIS_URL'),
        },
        defaultJobOptions: {
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
    // Event-driven architecture for decoupled, scalable services
    EventEmitterModule.forRoot({
      // Use wildcards for flexible event matching
      wildcard: true,
      // Delimiter for namespaced events (e.g., 'user.registered')
      delimiter: '.',
      // Enable detailed event tracking in development only
      verboseMemoryLeak: process.env.NODE_ENV === 'development',
      // Max listeners (default is 10, increase for complex event flows)
      maxListeners: 20,
      ignoreErrors: false,
    }),
    SharedModule,
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
    SubscriptionModule,
    PaymentModule,
    StoryBuddyModule,
    HelpSupportModule,
    AchievementProgressModule,
    ParentFavoriteModule,
    AdminModule,
    HealthModule,
    BullBoardConfigModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
