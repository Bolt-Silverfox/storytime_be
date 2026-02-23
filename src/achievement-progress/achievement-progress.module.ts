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
  ],
  exports: [BadgeProgressEngine, BadgeService],
})
export class AchievementProgressModule {}
