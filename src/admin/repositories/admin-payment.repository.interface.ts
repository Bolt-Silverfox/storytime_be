import type { ResolvedRate } from '../utils/fx-conversion.util';

/**
 * Revenue + transaction count for one (currency, applied FX rate) group. Rows
 * are grouped by the rate each payment converts at (see fx-conversion.util for
 * the selection rule), so the caller can convert without per-row work.
 * `rate` is null when the currency has no FX rate at all (unconverted).
 */
export interface RevenueRateRow {
  currency: string | null;
  amount: number;
  count: number;
  rate: ResolvedRate | null;
}

export interface UserPaymentAmount {
  amount: number;
  currency: string | null;
  createdAt: Date;
}

export interface DatedPaymentAmount {
  amount: number;
  currency: string | null;
  createdAt: Date;
}

export interface RevenueByPlan extends RevenueRateRow {
  plan: string | null;
}

export interface IAdminPaymentRepository {
  // Succeeded revenue + count grouped by (currency, applied rate) in ONE SQL
  // query (rate picked per transaction date). Optional createdAt cap.
  sumRevenueWithRates(filter?: {
    createdAtLte?: Date;
  }): Promise<RevenueRateRow[]>;

  // Successful transactions for a single user (amount + currency + date)
  findSuccessfulByUser(userId: string): Promise<UserPaymentAmount[]>;

  // Successful transactions in range (amount + currency + createdAt), ordered asc
  findSuccessfulInRange(
    startDate: Date,
    endDate: Date,
  ): Promise<DatedPaymentAmount[]>;

  // Successful revenue + count grouped by (plan, currency, applied rate), each
  // payment attributed to the plan it was for (top-plans analytics).
  groupRevenueByPlan(): Promise<RevenueByPlan[]>;
}

export const ADMIN_PAYMENT_REPOSITORY = Symbol('ADMIN_PAYMENT_REPOSITORY');
