import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Subscription } from '@prisma/client';
import type {
  IAdminSubscriptionRepository,
  SubscriptionPlanCount,
  SubscriptionStartedAtCount,
  SubscriptionWithUserRevenue,
  SubscriptionWithUser,
} from './admin-subscription.repository.interface';

@Injectable()
export class PrismaAdminSubscriptionRepository
  implements IAdminSubscriptionRepository
{
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

  async groupByStartedAt(
    startDate: Date,
    endDate: Date,
  ): Promise<SubscriptionStartedAtCount[]> {
    const result = await this.prisma.subscription.groupBy({
      by: ['startedAt'],
      where: {
        startedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _count: true,
    });
    return result as SubscriptionStartedAtCount[];
  }

  findActiveWithUserRevenue(): Promise<SubscriptionWithUserRevenue[]> {
    return this.prisma.subscription.findMany({
      where: {
        status: 'active',
      },
      include: {
        user: {
          include: {
            paymentTransactions: {
              where: {
                status: 'success',
                deletedAt: null,
              },
              select: {
                amount: true,
              },
            },
          },
        },
      },
    });
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
