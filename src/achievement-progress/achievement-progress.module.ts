import { Module, forwardRef } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { StreakService } from './streak.service';
import { BadgeService } from './badge.service';
import { BadgeProgressEngine } from './badge-progress.engine';
import { BadgeConstants } from './badge.constants';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300, // 5 minutes default TTL
      max: 100, // Max items in cache
    }),
    // EventEmitterModule is now globally registered in AppModule
    forwardRef(() => AuthModule),
    NotificationModule,
  ],
  controllers: [ProgressController],
  providers: [
    ProgressService,
    StreakService,
    BadgeService,
    BadgeProgressEngine,
    BadgeConstants,
  ],
  exports: [BadgeProgressEngine, BadgeService],
})
export class AchievementProgressModule {}
