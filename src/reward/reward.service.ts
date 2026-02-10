import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { RewardRedemption } from '@prisma/client';
import {
  CreateRewardDto,
  UpdateRewardDto,
  RedeemRewardDto,
  UpdateRewardRedemptionStatusDto,
  RewardRedemptionDto,
} from './dto/reward.dto';
import { IRewardRepository, REWARD_REPOSITORY } from './repositories';

@Injectable()
export class RewardService {
  constructor(
    @Inject(REWARD_REPOSITORY)
    private readonly rewardRepository: IRewardRepository,
  ) {}

  async create(dto: CreateRewardDto) {
    return this.rewardRepository.create(dto);
  }

  async findAll() {
    return this.rewardRepository.findAll();
  }

  async findOne(id: string) {
    const reward = await this.rewardRepository.findById(id);
    if (!reward) throw new NotFoundException('Reward not found');
    return reward;
  }

  async update(id: string, dto: UpdateRewardDto) {
    return this.rewardRepository.update(id, dto);
  }

  async delete(id: string) {
    return this.rewardRepository.delete(id);
  }

  async findByKid(kidId: string) {
    return this.rewardRepository.findByKidId(kidId);
  }

  private toRewardRedemptionDto(
    redemption: RewardRedemptionDto,
  ): RewardRedemptionDto {
    return {
      id: redemption.id,
      rewardId: redemption.rewardId,
      kidId: redemption.kidId,
      redeemedAt: redemption.redeemedAt,
      status: redemption.status,
    };
  }

  async redeemReward(dto: RedeemRewardDto): Promise<RewardRedemptionDto> {
    const redemption = await this.rewardRepository.createRedemption({
      rewardId: dto.rewardId,
      kidId: dto.kidId,
      status: 'pending',
    });
    return this.toRewardRedemptionDto(redemption);
  }

  async updateRedemptionStatus(
    dto: UpdateRewardRedemptionStatusDto,
  ): Promise<RewardRedemptionDto> {
    const redemption = await this.rewardRepository.updateRedemptionStatus(
      dto.redemptionId,
      dto.status,
    );
    return this.toRewardRedemptionDto(redemption);
  }

  async getRedemptionsForKid(kidId: string): Promise<RewardRedemptionDto[]> {
    const redemptions =
      await this.rewardRepository.findRedemptionsByKidId(kidId);
    return redemptions.map((r: RewardRedemption) =>
      this.toRewardRedemptionDto(r),
    );
  }

  async getRedemptionById(id: string): Promise<RewardRedemptionDto | null> {
    const redemption = await this.rewardRepository.findRedemptionById(id);
    return redemption ? this.toRewardRedemptionDto(redemption) : null;
  }
}
