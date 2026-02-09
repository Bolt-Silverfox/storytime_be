import { Module } from '@nestjs/common';
import { RewardService } from './reward.service';
import { RewardController } from './reward.controller';
import { AuthModule } from '@/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';
import {
  REWARD_REPOSITORY,
  PrismaRewardRepository,
} from './repositories';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RewardController],
  providers: [
    RewardService,
    {
      provide: REWARD_REPOSITORY,
      useClass: PrismaRewardRepository,
    },
  ],
  exports: [REWARD_REPOSITORY],
})
export class RewardModule {}
