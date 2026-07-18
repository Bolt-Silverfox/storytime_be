// ==================== Repository Interface ====================
export interface IRewardRedemptionRepository {
  // Count reward redemptions for a kid within a date range (redeemedAt)
  countInRange(kidId: string, gte: Date, lt: Date): Promise<number>;

  // Count reward redemptions for a kid since a date (redeemedAt)
  countSince(kidId: string, gte: Date): Promise<number>;
}

export const REWARD_REDEMPTION_REPOSITORY = Symbol(
  'REWARD_REDEMPTION_REPOSITORY',
);
