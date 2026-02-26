import { Module } from '@nestjs/common';
import { RewardService } from './reward.service';
import { RewardController } from './reward.controller';
import { AuthModule } from '@/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RewardController],
  providers: [RewardService],
})
export class RewardModule {}
