import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IRewardRedemptionRepository } from './reward-redemption.repository.interface';

@Injectable()
export class PrismaRewardRedemptionRepository
  implements IRewardRedemptionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async countInRange(kidId: string, gte: Date, lt: Date): Promise<number> {
    return this.prisma.rewardRedemption.count({
      where: {
        kidId,
        redeemedAt: {
          gte,
          lt,
        },
      },
    });
  }

  async countSince(kidId: string, gte: Date): Promise<number> {
    return this.prisma.rewardRedemption.count({
      where: {
        kidId,
        redeemedAt: { gte },
      },
    });
  }
}
