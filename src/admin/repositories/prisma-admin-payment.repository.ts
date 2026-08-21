import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type {
  IAdminPaymentRepository,
  RevenueSum,
  RevenueByDate,
  RevenueByPlan,
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

  // Aggregate revenue per CALENDAR DAY. A Prisma groupBy on `createdAt` groups
  // by the full timestamp, so every transaction becomes its own bucket and the
  // caller (which maps createdAt -> YYYY-MM-DD) emits per-transaction points
  // instead of a daily total. Fetch the rows in range and bucket by UTC day.
  async groupRevenueByCreatedAt(
    startDate: Date,
    endDate: Date,
  ): Promise<RevenueByDate[]> {
    const rows = await this.prisma.paymentTransaction.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: 'success',
        deletedAt: null,
      },
      select: { createdAt: true, amount: true },
    });
    return this.bucketRevenueByDay(rows);
  }

  // Same daily aggregation; result is already day-ascending.
  groupRevenueByCreatedAtOrdered(
    startDate: Date,
    endDate: Date,
  ): Promise<RevenueByDate[]> {
    return this.groupRevenueByCreatedAt(startDate, endDate);
  }

  private bucketRevenueByDay(
    rows: { createdAt: Date; amount: number }[],
  ): RevenueByDate[] {
    const byDay = new Map<string, number>();
    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + row.amount);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, amount]) => ({
        createdAt: new Date(`${day}T00:00:00.000Z`),
        _sum: { amount },
      }));
  }

  // Sum revenue and count transactions per plan, in the DB. Replaces loading
  // every active subscriber's entire transaction history into memory and
  // charging their lifetime spend to their current plan.
  async groupRevenueByPlan(): Promise<RevenueByPlan[]> {
    const rows = await this.prisma.paymentTransaction.groupBy({
      by: ['plan'],
      where: { status: 'success', deletedAt: null },
      _sum: { amount: true },
      _count: true,
    });
    return rows.map((row) => ({
      plan: row.plan,
      _sum: { amount: row._sum.amount },
      _count: row._count,
    }));
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
