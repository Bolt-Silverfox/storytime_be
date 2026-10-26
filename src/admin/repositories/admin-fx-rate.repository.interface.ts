import type { FxRate } from '@prisma/client';

export interface CreateFxRateInput {
  currency: string;
  rateToUsd: number;
  effectiveFrom: Date;
  source: string;
  createdByAdminId: string | null;
}

export interface IAdminFxRateRepository {
  /** All rates (optionally one currency), ordered by currency, effectiveFrom desc. */
  list(currency?: string): Promise<FxRate[]>;
  findById(id: string): Promise<FxRate | null>;
  create(input: CreateFxRateInput): Promise<FxRate>;
  delete(id: string): Promise<void>;
}

export const ADMIN_FX_RATE_REPOSITORY = Symbol('ADMIN_FX_RATE_REPOSITORY');
