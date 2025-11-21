import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, RewardRedemption } from '@prisma/client';
import {
  CreateRewardDto,
  UpdateRewardDto,
  RedeemRewardDto,
  UpdateRewardRedemptionStatusDto,
  RewardRedemptionDto,
} from './reward.dto';
import { SoftDeleteService } from '../common/soft-delete.service';

const prisma = new PrismaClient();

@Injectable()
export class RewardService {
  constructor(private softDeleteService: SoftDeleteService) {}

  async create(dto: CreateRewardDto) {
    return await prisma.reward.create({
      data: {
        name: dto.name,
        description: dto.description,
        points: dto.points,
        imageUrl: dto.imageUrl,
        kidId: dto.kidId,
      },
    });
  }

  async findAll() {
    return await prisma.reward.findMany({
      where: {
        deletedAt: null
      }
    });
  }

  async findOne(id: string) {
    const reward = await prisma.reward.findUnique({ 
      where: { 
        id,
        deletedAt: null 
      } 
    });
    if (!reward) throw new NotFoundException('Reward not found');
    return reward;
  }

  async update(id: string, dto: UpdateRewardDto) {
    return await prisma.reward.update({ 
      where: { 
        id,
        deletedAt: null 
      }, 
      data: dto 
    });
  }

  async softDeleteReward(id: string) {
    return await this.softDeleteService.softDelete('reward', id);
  }

  async undoDeleteReward(id: string): Promise<boolean> {
    return await this.softDeleteService.undoSoftDelete('reward', id);
  }

  async permanentDeleteReward(id: string) {
    return await this.softDeleteService.permanentDelete('reward', id);
  }

  async findByKid(kidId: string) {
    return await prisma.reward.findMany({ 
      where: { 
        kidId,
        deletedAt: null 
      } 
    });
  }

  private toRewardRedemptionDto(redemption: RewardRedemptionDto): RewardRedemptionDto {
    return {
      id: redemption.id,
      rewardId: redemption.rewardId,
      kidId: redemption.kidId,
      redeemedAt: redemption.redeemedAt,
      status: redemption.status,
    };
  }

  async redeemReward(dto: RedeemRewardDto): Promise<RewardRedemptionDto> {
    const redemption = await prisma.rewardRedemption.create({
      data: {
        rewardId: dto.rewardId,
        kidId: dto.kidId,
        status: 'pending',
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
    return redemptions.map((r: RewardRedemption) => this.toRewardRedemptionDto(r));
  }

  async getRedemptionById(id: string): Promise<RewardRedemptionDto | null> {
    const redemption = await prisma.rewardRedemption.findUnique({
      where: { id },
    });
    return redemption ? this.toRewardRedemptionDto(redemption) : null;
  }
}