import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type {
  IAdminPaymentRepository,
  RevenueSum,
  RevenueByDate,
  UserPaymentAmount,
  DatedPaymentAmount,
} from './admin-payment.repository.interface';

@Injectable()
export class PrismaAdminPaymentRepository implements IAdminPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  sumRevenue(where: Prisma.PaymentTransactionWhereInput): Promise<RevenueSum> {
    return this.prisma.paymentTransaction.aggregate({
      where,
      _sum: { amount: true },
    });
  }

  findSuccessfulByUser(userId: string): Promise<UserPaymentAmount[]> {
    return this.prisma.paymentTransaction.findMany({
      where: { userId, status: 'success', deletedAt: null },
      select: { amount: true, currency: true },
    });
  }

  async groupRevenueByCreatedAt(
    startDate: Date,
    endDate: Date,
  ): Promise<RevenueByDate[]> {
    const result = await this.prisma.paymentTransaction.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: 'success',
        deletedAt: null,
      },
      _sum: {
        amount: true,
      },
    });
    return result as RevenueByDate[];
  }

  async groupRevenueByCreatedAtOrdered(
    startDate: Date,
    endDate: Date,
  ): Promise<RevenueByDate[]> {
    const result = await this.prisma.paymentTransaction.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: 'success',
        deletedAt: null,
      },
      _sum: {
        amount: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    return result as RevenueByDate[];
  }

  findSuccessfulInRange(
    startDate: Date,
    endDate: Date,
  ): Promise<DatedPaymentAmount[]> {
    return this.prisma.paymentTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: 'success',
        deletedAt: null,
      },
      select: {
        amount: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }
}
