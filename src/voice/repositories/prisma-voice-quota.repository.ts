import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IVoiceQuotaRepository,
  UserWithSubscriptionsAndUsage,
} from './voice-quota.repository.interface';
import type {
  UserUsage,
  Voice,
  ActivityLog,
  Subscription,
  Prisma,
} from '@prisma/client';
import { SUBSCRIPTION_STATUS } from '@/subscription/subscription.constants';

@Injectable()
export class PrismaVoiceQuotaRepository implements IVoiceQuotaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserWithSubscriptionsAndUsage(
    userId: string,
    currentDate: Date,
  ): Promise<UserWithSubscriptionsAndUsage | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          where: {
            status: SUBSCRIPTION_STATUS.ACTIVE,
            OR: [{ endsAt: { gt: currentDate } }, { endsAt: null }],
          },
          take: 1,
        },
        usage: true,
      },
    });
  }

  async findUserUsage(userId: string): Promise<UserUsage | null> {
    return this.prisma.userUsage.findUnique({
      where: { userId },
    });
  }

  async updateUsageMonth(
    userId: string,
    excludeMonth: string,
    newMonth: string,
    resetData: Partial<UserUsage>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    await client.userUsage.updateMany({
      where: { userId, currentMonth: { not: excludeMonth } },
      data: { currentMonth: newMonth, ...resetData },
    });
  }

  async upsertUserUsage(
    userId: string,
    createData: Partial<UserUsage>,
    updateData: Partial<UserUsage> | { [key: string]: any },
    tx?: Prisma.TransactionClient,
  ): Promise<UserUsage> {
    const client = tx || this.prisma;
    // Remove userId from createData if present, as we use it via user relation
    const { userId: _userId, ...createWithoutUserId } = createData as any;
    return client.userUsage.upsert({
      where: { userId },
      create: {
        user: { connect: { id: userId } },
        ...createWithoutUserId,
      } as Prisma.UserUsageCreateInput,
      update: updateData as Prisma.UserUsageUpdateInput,
    });
  }

  async executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog> {
    return this.prisma.activityLog.create({
      data,
    });
  }

  async findVoiceById(voiceId: string): Promise<Voice | null> {
    return this.prisma.voice.findUnique({
      where: { id: voiceId },
    });
  }

  async findVoiceWithAccess(
    voiceId: string,
    userId: string,
  ): Promise<Voice | null> {
    return this.prisma.voice.findFirst({
      where: {
        id: voiceId,
        OR: [{ userId }, { userId: null }],
      },
    });
  }

  async findActiveSubscription(
    userId: string,
    currentDate: Date,
  ): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        OR: [{ endsAt: { gt: currentDate } }, { endsAt: null }],
      },
    });
  }
}
