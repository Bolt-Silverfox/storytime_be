import type { Prisma } from '@prisma/client';

export interface RevenueSum {
  _sum: { amount: number | null };
}

export interface RevenueByDate {
  createdAt: Date;
  _sum: { amount: number | null };
}

export interface UserPaymentAmount {
  amount: number;
  currency: string | null;
}

export interface DatedPaymentAmount {
  amount: number;
  createdAt: Date;
}

export interface IAdminPaymentRepository {
  // Aggregate successful revenue for an arbitrary where clause
  sumRevenue(where: Prisma.PaymentTransactionWhereInput): Promise<RevenueSum>;

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

  // Successful transactions in range (amount + createdAt), ordered asc
  findSuccessfulInRange(
    startDate: Date,
    endDate: Date,
  ): Promise<DatedPaymentAmount[]>;
}

export const ADMIN_PAYMENT_REPOSITORY = Symbol('ADMIN_PAYMENT_REPOSITORY');
