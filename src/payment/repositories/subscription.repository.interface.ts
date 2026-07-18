import type { Subscription, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface ISubscriptionRepository {
  // Find the first subscription owned by a user
  findFirstByUser(userId: string): Promise<Subscription | null>;

  // Update a subscription by id
  updateById(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
  ): Promise<Subscription>;

  // Create a subscription
  create(data: Prisma.SubscriptionUncheckedCreateInput): Promise<Subscription>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
