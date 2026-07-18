import type { Prisma, Subscription } from '@prisma/client';

export interface SubscriptionPlanCount {
  plan: string;
  _count: number;
}

export interface SubscriptionStartedAtCount {
  startedAt: Date;
  _count: number;
}

// Active subscriptions joined with each owner's successful payments (revenue)
export type SubscriptionWithUserRevenue = Prisma.SubscriptionGetPayload<{
  include: {
    user: {
      include: {
        paymentTransactions: {
          select: { amount: true };
        };
      };
    };
  };
}>;

export type SubscriptionWithUser = Prisma.SubscriptionGetPayload<{
  include: {
    user: { select: { id: true; email: true; name: true } };
  };
}>;

export interface IAdminSubscriptionRepository {
  count(where: Prisma.SubscriptionWhereInput): Promise<number>;

  // Active plan breakdown (status active + not expired at `now`)
  groupByActivePlan(now: Date): Promise<SubscriptionPlanCount[]>;

  // Subscription growth grouped by start date in range
  groupByStartedAt(
    startDate: Date,
    endDate: Date,
  ): Promise<SubscriptionStartedAtCount[]>;

  // All active subscriptions with owner revenue (top plans)
  findActiveWithUserRevenue(): Promise<SubscriptionWithUserRevenue[]>;

  findByUserId(userId: string): Promise<Subscription | null>;

  upsertForActivation(params: {
    userId: string;
    create: Prisma.SubscriptionUpsertArgs['create'];
    update: Prisma.SubscriptionUpsertArgs['update'];
  }): Promise<SubscriptionWithUser>;
}

export const ADMIN_SUBSCRIPTION_REPOSITORY = Symbol(
  'ADMIN_SUBSCRIPTION_REPOSITORY',
);
