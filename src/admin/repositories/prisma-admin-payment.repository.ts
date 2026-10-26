import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ResolvedRate, implicitUsdRate } from '../utils/fx-conversion.util';
import type {
  IAdminPaymentRepository,
  RevenueByPlan,
  RevenueRateRow,
  UserPaymentAmount,
  DatedPaymentAmount,
} from './admin-payment.repository.interface';

interface RawRateRow {
  currency: string | null;
  rate: number | null;
  effectiveFrom: Date | null;
  usedEarliest: boolean | null;
  amount: number;
  count: number;
}

/**
 * Per transaction, the FX rate that applies (same rule as FxRateTable.resolve):
 * the latest rate effective at/before the transaction date, else the earliest
 * rate (flagged), else none. fx_rates is tiny and indexed on
 * (currency, effectiveFrom), so this is one index probe per distinct group.
 */
const RATE_JOIN = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT r."rateToUsd"::float8 AS "rate",
           r."effectiveFrom" AS "effectiveFrom",
           (r."effectiveFrom" > t."createdAt") AS "usedEarliest"
    FROM "fx_rates" r
    WHERE r."currency" = upper(btrim(t."currency"))
    ORDER BY (r."effectiveFrom" <= t."createdAt") DESC,
             CASE WHEN r."effectiveFrom" <= t."createdAt" THEN r."effectiveFrom" END DESC,
             r."effectiveFrom" ASC
    LIMIT 1
  ) fx ON true`;

const NORMALIZED_CURRENCY = Prisma.sql`NULLIF(upper(btrim(t."currency")), '')`;

function toResolvedRate(row: RawRateRow): ResolvedRate | null {
  if (row.rate !== null && row.rate !== undefined) {
    return {
      rate: Number(row.rate),
      effectiveFrom: row.effectiveFrom,
      usedEarliest: Boolean(row.usedEarliest),
    };
  }
  return row.currency === 'USD' ? implicitUsdRate() : null;
}

@Injectable()
export class PrismaAdminPaymentRepository implements IAdminPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async sumRevenueWithRates(filter?: {
    createdAtLte?: Date;
  }): Promise<RevenueRateRow[]> {
    const cap = filter?.createdAtLte
      ? Prisma.sql`AND t."createdAt" <= ${filter.createdAtLte}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<RawRateRow[]>(Prisma.sql`
      SELECT ${NORMALIZED_CURRENCY} AS "currency",
             fx."rate", fx."effectiveFrom", fx."usedEarliest",
             COALESCE(SUM(t."amount"), 0)::float8 AS "amount",
             COUNT(*)::int AS "count"
      FROM "payment_transactions" t
      ${RATE_JOIN}
      WHERE t."status" = 'success' AND t."deletedAt" IS NULL ${cap}
      GROUP BY 1, fx."rate", fx."effectiveFrom", fx."usedEarliest"`);
    return rows.map((row) => ({
      currency: row.currency,
      amount: Number(row.amount),
      count: Number(row.count),
      rate: toResolvedRate(row),
    }));
  }

  findSuccessfulByUser(userId: string): Promise<UserPaymentAmount[]> {
    return this.prisma.paymentTransaction.findMany({
      where: { userId, status: 'success', deletedAt: null },
      select: { amount: true, currency: true, createdAt: true },
    });
  }

  // Sum revenue and count transactions per plan, in the DB. Replaces loading
  // every active subscriber's entire transaction history into memory and
  // charging their lifetime spend to their current plan.
  async groupRevenueByPlan(): Promise<RevenueByPlan[]> {
    const rows = await this.prisma.$queryRaw<
      (RawRateRow & { plan: string | null })[]
    >(Prisma.sql`
      SELECT t."plan" AS "plan", ${NORMALIZED_CURRENCY} AS "currency",
             fx."rate", fx."effectiveFrom", fx."usedEarliest",
             COALESCE(SUM(t."amount"), 0)::float8 AS "amount",
             COUNT(*)::int AS "count"
      FROM "payment_transactions" t
      ${RATE_JOIN}
      WHERE t."status" = 'success' AND t."deletedAt" IS NULL
      GROUP BY t."plan", 2, fx."rate", fx."effectiveFrom", fx."usedEarliest"`);
    return rows.map((row) => ({
      plan: row.plan,
      currency: row.currency,
      amount: Number(row.amount),
      count: Number(row.count),
      rate: toResolvedRate(row),
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
