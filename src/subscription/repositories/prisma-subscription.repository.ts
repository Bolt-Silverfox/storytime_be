import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { ISubscriptionRepository } from './subscription.repository.interface';
import type { Subscription, Prisma } from '@prisma/client';

@Injectable()
export class PrismaSubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findFirstByUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    const client = tx ?? this.prisma;
    return client.subscription.findFirst({
      where: { userId },
    });
  }

  async updateById(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;
    return client.subscription.update({
      where: { id },
      data,
    });
  }

  async create(
    data: Prisma.SubscriptionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;
    return client.subscription.create({ data });
  }

  async executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
