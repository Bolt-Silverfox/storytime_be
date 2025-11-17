import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  CreateRewardDto,
  RedeemRewardDto,
  RewardRedemptionDto,
  UpdateRewardDto,
  UpdateRewardRedemptionStatusDto,
} from './reward.dto';

const prisma = new PrismaClient();

@Injectable()
export class RewardService {
  async create(dto: CreateRewardDto) {
    return await prisma.reward.create({
      data: {
        name: dto.name,
        description: dto.description ?? '', // fallback in case undefined
        points: dto.points,
        imageUrl: dto.imageUrl ?? '',
        kidId: dto.kidId,
        isActive: true,
      },
    });
  }

  async findAll() {
    return await prisma.reward.findMany();
  }

  async findOne(id: string) {
    const reward = await prisma.reward.findUnique({ where: { id } });
    if (!reward) throw new NotFoundException('Reward not found');
    return reward;
  }

  async update(id: string, dto: UpdateRewardDto) {
    return await prisma.reward.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    return await prisma.reward.delete({ where: { id } });
  }

  async findByKid(kidId: string) {
    return await prisma.reward.findMany({ where: { kidId } });
  }

  private toRewardRedemptionDto(redemption: any): RewardRedemptionDto {
    return {
      id: redemption.id,
      rewardId: redemption.rewardId,
      kidId: redemption.kidId,
      redeemedAt: redemption.redeemedAt,
      pointsRedeemed: redemption.pointsRedeemed,
      status: redemption.status,
    };
  }

  async redeemReward(dto: RedeemRewardDto): Promise<RewardRedemptionDto> {
    const redemption = await prisma.rewardRedemption.create({
      data: {
        rewardId: dto.rewardId,
        kidId: dto.kidId,
        status: 'pending',
        redeemedAt: new Date(), // required field
        pointsRedeemed: 0, // required field
      },
    });
    return this.toRewardRedemptionDto(redemption);
  }

  async updateRedemptionStatus(
    dto: UpdateRewardRedemptionStatusDto,
  ): Promise<RewardRedemptionDto> {
    const redemption = await prisma.rewardRedemption.update({
      where: { id: dto.redemptionId },
      data: { status: dto.status },
    });
    return this.toRewardRedemptionDto(redemption);
  }

  async getRedemptionsForKid(kidId: string): Promise<RewardRedemptionDto[]> {
    const redemptions = await prisma.rewardRedemption.findMany({
      where: { kidId },
    });
    return redemptions.map((r) => this.toRewardRedemptionDto(r));
  }

  async getRedemptionById(id: string): Promise<RewardRedemptionDto | null> {
    const redemption = await prisma.rewardRedemption.findUnique({
      where: { id },
    });
    return redemption ? this.toRewardRedemptionDto(redemption) : null;
  }
}
