import type { Subscription, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface ISubscriptionRepository {
  // Find the first subscription owned by a user (optionally within a transaction)
  findFirstByUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription | null>;

  // Update a subscription by id (optionally within a transaction)
  updateById(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription>;

  // Create a subscription (optionally within a transaction)
  create(
    data: Prisma.SubscriptionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription>;

  // Execute a transaction
  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
