import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CurrencyTotals,
  addToCurrencyTotals,
} from '../utils/revenue-currency.util';
import type {
  IAdminPaymentRepository,
  RevenueByCurrencyRow,
  RevenueByDate,
  RevenueByPlan,
  UserPaymentAmount,
  DatedPaymentAmount,
} from './admin-payment.repository.interface';

@Injectable()
export class PrismaAdminPaymentRepository implements IAdminPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async sumRevenueByCurrency(
    where: Prisma.PaymentTransactionWhereInput,
  ): Promise<RevenueByCurrencyRow[]> {
    const rows = await this.prisma.paymentTransaction.groupBy({
      by: ['currency'],
      where,
      _sum: { amount: true },
      _count: true,
    });
    return rows.map((row) => ({
      currency: row.currency,
      amount: row._sum.amount ?? 0,
      count: row._count,
    }));
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
      select: { createdAt: true, amount: true, currency: true },
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
    rows: { createdAt: Date; amount: number; currency: string | null }[],
  ): RevenueByDate[] {
    const byDay = new Map<string, CurrencyTotals>();
    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      const totals = byDay.get(day) ?? {};
      addToCurrencyTotals(totals, row.currency, row.amount);
      byDay.set(day, totals);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, byCurrency]) => ({
        createdAt: new Date(`${day}T00:00:00.000Z`),
        byCurrency,
      }));
  }

  // Sum revenue and count transactions per plan, in the DB. Replaces loading
  // every active subscriber's entire transaction history into memory and
  // charging their lifetime spend to their current plan.
  async groupRevenueByPlan(): Promise<RevenueByPlan[]> {
    const rows = await this.prisma.paymentTransaction.groupBy({
      by: ['plan', 'currency'],
      where: { status: 'success', deletedAt: null },
      _sum: { amount: true },
      _count: true,
    });
    return rows.map((row) => ({
      plan: row.plan,
      currency: row.currency,
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
        currency: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }
}
