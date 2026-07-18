import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { ICouponRedemptionRepository } from './coupon-redemption.repository.interface';
import type { CouponRedemption, Prisma } from '@prisma/client';

@Injectable()
export class PrismaCouponRedemptionRepository
  implements ICouponRedemptionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findUniqueByCouponAndUser(
    couponId: string,
    userId: string,
  ): Promise<CouponRedemption | null> {
    return this.prisma.couponRedemption.findUnique({
      where: { couponId_userId: { couponId, userId } },
    });
  }

  async create(
    data: Prisma.CouponRedemptionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<CouponRedemption> {
    const client = tx ?? this.prisma;
    return client.couponRedemption.create({ data });
  }
}
