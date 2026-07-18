import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Coupon } from '@prisma/client';
import type {
  IAdminCouponRepository,
  CouponWithRedemptionCount,
  CouponWithRedemptions,
} from './admin-coupon.repository.interface';

@Injectable()
export class PrismaAdminCouponRepository implements IAdminCouponRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(code: string): Promise<Coupon | null> {
    return this.prisma.coupon.findUnique({
      where: { code },
    });
  }

  findById(id: string): Promise<Coupon | null> {
    return this.prisma.coupon.findUnique({ where: { id } });
  }

  findByIdWithRedemptions(id: string): Promise<CouponWithRedemptions | null> {
    return this.prisma.coupon.findUnique({
      where: { id },
      include: {
        redemptions: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  create(data: Prisma.CouponCreateInput): Promise<Coupon> {
    return this.prisma.coupon.create({ data });
  }

  update(id: string, data: Prisma.CouponUpdateInput): Promise<Coupon> {
    return this.prisma.coupon.update({ where: { id }, data });
  }

  count(where: Prisma.CouponWhereInput): Promise<number> {
    return this.prisma.coupon.count({ where });
  }

  findManyPaginated(params: {
    where: Prisma.CouponWhereInput;
    skip: number;
    take: number;
  }): Promise<CouponWithRedemptionCount[]> {
    return this.prisma.coupon.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { redemptions: true } },
      },
    });
  }
}
