import { Module } from '@nestjs/common';
import { RewardService } from './reward.service';
import { RewardController } from './reward.controller';
import { SoftDeleteService } from '../common/soft-delete.service';
import PrismaService from '../prisma/prisma.service'; // Add this import

@Module({
  controllers: [RewardController],
  providers: [RewardService, SoftDeleteService, PrismaService],
})
export class RewardModule {}