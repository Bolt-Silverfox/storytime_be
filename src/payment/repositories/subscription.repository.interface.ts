import type { Subscription, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface ISubscriptionRepository {
  // Find the first subscription owned by a user
  findFirstByUser(userId: string): Promise<Subscription | null>;

  // Find a subscription by id (used to re-read a row after a compare-and-swap
  // write misses, to distinguish an idempotent repeat from a concurrent clobber)
  findById(id: string): Promise<Subscription | null>;

  // Update a subscription by id
  updateById(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
  ): Promise<Subscription>;

  // Compare-and-swap update: mutate the row ONLY while its stored purchaseToken
  // still equals `expectedToken` (pass `null` to match a currently-null token).
  // The token match is folded into the write so a concurrent replacement between
  // an in-memory read and this write cannot be clobbered. Returns the number of
  // rows affected (1 = the guard matched and the write applied; 0 = a concurrent
  // writer already changed the token, so nothing was written).
  updateByIdIfToken(
    id: string,
    expectedToken: string | null,
    data: Prisma.SubscriptionUncheckedUpdateInput,
  ): Promise<number>;

  // Create a subscription
  create(data: Prisma.SubscriptionUncheckedCreateInput): Promise<Subscription>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
