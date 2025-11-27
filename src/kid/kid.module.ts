import { Module } from '@nestjs/common';
import { KidProgressController } from './kid-progress.controller';
import { KidProgressService } from './kid-progress.service';
import { AuthModule } from '../../auth/auth.module';

// submodules
import { KidAchievementsModule } from './achievements/kid-achievements.module';
import { KidStreakModule } from './streak/kid-streak.module';
import { KidOverviewModule } from './overview/kid-overview.module';

@Module({
  imports: [
    AuthModule,          
    KidAchievementsModule,
    KidStreakModule,
    KidOverviewModule,
  ],
  controllers: [KidProgressController],
  providers: [KidProgressService],
  exports: [KidProgressService],
})
export class KidProgressModule {}
