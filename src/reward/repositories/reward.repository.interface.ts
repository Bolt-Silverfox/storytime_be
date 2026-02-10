import { Reward, RewardRedemption } from '@prisma/client';
import { CreateRewardDto, UpdateRewardDto } from '../dto/reward.dto';

export interface IRewardRepository {
  // Reward operations
  create(data: CreateRewardDto): Promise<Reward>;
  findAll(): Promise<Reward[]>;
  findById(id: string): Promise<Reward | null>;
  findByKidId(kidId: string): Promise<Reward[]>;
  update(id: string, data: UpdateRewardDto): Promise<Reward>;
  delete(id: string): Promise<Reward>;

  // Redemption operations
  createRedemption(data: {
    rewardId: string;
    kidId: string;
    status: string;
  }): Promise<RewardRedemption>;
  findRedemptionById(id: string): Promise<RewardRedemption | null>;
  findRedemptionsByKidId(kidId: string): Promise<RewardRedemption[]>;
  updateRedemptionStatus(id: string, status: string): Promise<RewardRedemption>;
}

export const REWARD_REPOSITORY = Symbol('REWARD_REPOSITORY');
