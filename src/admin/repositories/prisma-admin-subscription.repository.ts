import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Subscription } from '@prisma/client';
import type {
  IAdminSubscriptionRepository,
  SubscriptionPlanCount,
  SubscriptionStartedAtCount,
  SubscriptionWithUser,
} from './admin-subscription.repository.interface';

@Injectable()
export class PrismaAdminSubscriptionRepository implements IAdminSubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  count(where: Prisma.SubscriptionWhereInput): Promise<number> {
    return this.prisma.subscription.count({ where });
  }

  async groupByActivePlan(now: Date): Promise<SubscriptionPlanCount[]> {
    const result = await this.prisma.subscription.groupBy({
      by: ['plan'],
      where: {
        status: 'active',
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      _count: true,
    });
    return result as SubscriptionPlanCount[];
  }

  // Count new subscriptions per CALENDAR DAY. groupBy on `startedAt` buckets by
  // the full timestamp, so the caller (which maps startedAt -> YYYY-MM-DD) would
  // emit one point per subscription instead of a daily count. Fetch in range and
  // bucket by UTC day.
  async groupByStartedAt(
    startDate: Date,
    endDate: Date,
  ): Promise<SubscriptionStartedAtCount[]> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        startedAt: { gte: startDate, lte: endDate },
      },
      select: { startedAt: true },
    });

    const byDay = new Map<string, number>();
    for (const row of rows) {
      const day = row.startedAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, count]) => ({
        startedAt: new Date(`${day}T00:00:00.000Z`),
        _count: count,
      }));
  }

  findByUserId(userId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({
      where: { userId },
    });
  }

  upsertForActivation(params: {
    userId: string;
    create: Prisma.SubscriptionUpsertArgs['create'];
    update: Prisma.SubscriptionUpsertArgs['update'];
  }): Promise<SubscriptionWithUser> {
    return this.prisma.subscription.upsert({
      where: { userId: params.userId },
      create: params.create,
      update: params.update,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });
  }
}
