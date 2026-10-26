import type { Prisma, Subscription } from '@prisma/client';

export interface SubscriptionPlanCount {
  plan: string;
  _count: number;
}

export interface SubscriptionSourceCount {
  source: string;
  _count: number;
}

export interface SubscriptionStartedAtCount {
  startedAt: Date;
  _count: number;
}

export type SubscriptionWithUser = Prisma.SubscriptionGetPayload<{
  include: {
    user: { select: { id: true; email: true; name: true } };
  };
}>;

export interface IAdminSubscriptionRepository {
  count(where: Prisma.SubscriptionWhereInput): Promise<number>;

  // Active plan breakdown (status active + not expired at `now`). `extraWhere`
  // narrows it, e.g. { source: 'store' } for paying subscriptions only.
  groupByActivePlan(
    now: Date,
    extraWhere?: Prisma.SubscriptionWhereInput,
  ): Promise<SubscriptionPlanCount[]>;

  // Active access broken down by how it was obtained (store, admin_grant, ...)
  groupByActiveSource(now: Date): Promise<SubscriptionSourceCount[]>;

  // Subscription growth grouped by start date in range (optionally narrowed)
  groupByStartedAt(
    startDate: Date,
    endDate: Date,
    extraWhere?: Prisma.SubscriptionWhereInput,
  ): Promise<SubscriptionStartedAtCount[]>;

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
