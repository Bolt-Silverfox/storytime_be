import type { Prisma } from '@prisma/client';

/** One row per currency (null currency = legacy/unknown). Never summed across currencies. */
export interface RevenueByCurrencyRow {
  currency: string | null;
  amount: number;
  count: number;
}

export interface RevenueByDate {
  createdAt: Date;
  /** Day total per (normalized) currency, e.g. { NGN: 5000, USD: 4.99 }. */
  byCurrency: Record<string, number>;
}

export interface UserPaymentAmount {
  amount: number;
  currency: string | null;
}

export interface DatedPaymentAmount {
  amount: number;
  currency: string | null;
  createdAt: Date;
}

export interface RevenueByPlan {
  plan: string | null;
  currency: string | null;
  _sum: { amount: number | null };
  _count: number;
}

export interface IAdminPaymentRepository {
  // Revenue + transaction count per currency for an arbitrary where clause
  sumRevenueByCurrency(
    where: Prisma.PaymentTransactionWhereInput,
  ): Promise<RevenueByCurrencyRow[]>;

  // Successful transactions for a single user (amount + currency)
  findSuccessfulByUser(userId: string): Promise<UserPaymentAmount[]>;

  // Revenue grouped by createdAt in range (subscription analytics — unordered)
  groupRevenueByCreatedAt(
    startDate: Date,
    endDate: Date,
  ): Promise<RevenueByDate[]>;

  // Revenue grouped by createdAt in range, ordered asc (revenue analytics)
  groupRevenueByCreatedAtOrdered(
    startDate: Date,
    endDate: Date,
  ): Promise<RevenueByDate[]>;

  // Successful transactions in range (amount + currency + createdAt), ordered asc
  findSuccessfulInRange(
    startDate: Date,
    endDate: Date,
  ): Promise<DatedPaymentAmount[]>;

  // Successful revenue + transaction count grouped by (plan, currency); each payment was
  // for (top-plans analytics). Attributes each payment to its own plan rather
  // than to the payer's current subscription.
  groupRevenueByPlan(): Promise<RevenueByPlan[]>;
}

export const ADMIN_PAYMENT_REPOSITORY = Symbol('ADMIN_PAYMENT_REPOSITORY');
