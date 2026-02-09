import { Injectable } from '@nestjs/common';
import { Reward, RewardRedemption } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateRewardDto, UpdateRewardDto } from '../dto/reward.dto';
import { IRewardRepository } from './reward.repository.interface';

@Injectable()
export class PrismaRewardRepository implements IRewardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Reward operations
  async create(data: CreateRewardDto): Promise<Reward> {
    return this.prisma.reward.create({
      data: {
        name: data.name,
        description: data.description,
        points: data.points,
        imageUrl: data.imageUrl,
        kidId: data.kidId,
      },
    });
  }

  async findAll(): Promise<Reward[]> {
    return this.prisma.reward.findMany();
  }

  async findById(id: string): Promise<Reward | null> {
    return this.prisma.reward.findUnique({ where: { id } });
  }

  async findByKidId(kidId: string): Promise<Reward[]> {
    return this.prisma.reward.findMany({ where: { kidId } });
  }

  async update(id: string, data: UpdateRewardDto): Promise<Reward> {
    return this.prisma.reward.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Reward> {
    return this.prisma.reward.delete({ where: { id } });
  }

  // Redemption operations
  async createRedemption(data: {
    rewardId: string;
    kidId: string;
    status: string;
  }): Promise<RewardRedemption> {
    return this.prisma.rewardRedemption.create({ data });
  }

  async findRedemptionById(id: string): Promise<RewardRedemption | null> {
    return this.prisma.rewardRedemption.findUnique({ where: { id } });
  }

  async findRedemptionsByKidId(kidId: string): Promise<RewardRedemption[]> {
    return this.prisma.rewardRedemption.findMany({ where: { kidId } });
  }

  async updateRedemptionStatus(
    id: string,
    status: string,
  ): Promise<RewardRedemption> {
    return this.prisma.rewardRedemption.update({
      where: { id },
      data: { status },
    });
  }
}
