import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { ISubscriptionRepository } from './subscription.repository.interface';
import type { Subscription, Prisma } from '@prisma/client';

@Injectable()
export class PrismaSubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findFirstByUser(userId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: { userId },
    });
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: { id },
    });
  }

  async updateById(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
  ): Promise<Subscription> {
    return this.prisma.subscription.update({
      where: { id },
      data,
    });
  }

  async updateByIdIfToken(
    id: string,
    expectedToken: string | null,
    data: Prisma.SubscriptionUncheckedUpdateInput,
  ): Promise<number> {
    // Compare-and-swap: the `purchaseToken` guard is folded into the WHERE so the
    // token match and the write happen atomically. If a concurrent verification
    // changed the token between the caller's read and this write, the WHERE
    // matches no row and `count === 0` — the caller must NOT overwrite the winner.
    const res = await this.prisma.subscription.updateMany({
      where: { id, purchaseToken: expectedToken },
      data: data as Prisma.SubscriptionUpdateManyMutationInput,
    });
    return res.count;
  }

  async create(
    data: Prisma.SubscriptionUncheckedCreateInput,
  ): Promise<Subscription> {
    return this.prisma.subscription.create({ data });
  }
}
