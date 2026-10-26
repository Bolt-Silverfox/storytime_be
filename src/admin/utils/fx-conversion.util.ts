/**
 * FX conversion of revenue into the base currency (USD).
 *
 * Rate selection (the single rule used by EVERY revenue figure):
 *  - USD is implicit (rate 1, no row needed).
 *  - A transaction converts at the latest FxRate whose effectiveFrom is <= the
 *    transaction's createdAt.
 *  - If none is that old, the EARLIEST rate of that currency is used and the
 *    conversion is flagged `usedEarliest`.
 *  - A currency with no rate at all is NOT converted (never guessed): it is
 *    reported as unconverted and excluded from the converted total.
 * Rounding to 2 dp happens only on final figures, never on intermediates.
 */
import {
  CurrencyTotals,
  RevenueByCurrencyItem,
  addToCurrencyTotals,
  normalizeCurrency,
  roundMoney,
  summarizeRevenue,
  UNKNOWN_CURRENCY,
} from './revenue-currency.util';

export const BASE_CURRENCY = 'USD';

export interface FxRateRecord {
  id?: string;
  currency: string;
  /** USD per 1 unit of `currency`. */
  rateToUsd: number;
  effectiveFrom: Date;
}

export interface ResolvedRate {
  rate: number;
  /** null for the implicit USD rate. */
  effectiveFrom: Date | null;
  /** True when no rate was effective yet and the earliest one was used. */
  usedEarliest: boolean;
}

const USD_RATE: ResolvedRate = {
  rate: 1,
  effectiveFrom: null,
  usedEarliest: false,
};

/** Resolution of a rate for USD (implicit) - shared with the SQL path. */
export function implicitUsdRate(): ResolvedRate {
  return { ...USD_RATE };
}

export class FxRateTable {
  private readonly byCurrency = new Map<string, FxRateRecord[]>();

  constructor(rows: readonly FxRateRecord[]) {
    for (const row of rows) {
      const key = row.currency.trim().toUpperCase();
      const list = this.byCurrency.get(key) ?? [];
      list.push(row);
      this.byCurrency.set(key, list);
    }
    for (const list of this.byCurrency.values()) {
      list.sort(
        (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
      );
    }
  }

  has(currency: string | null | undefined): boolean {
    const key = normalizeCurrency(currency);
    return key === BASE_CURRENCY || this.byCurrency.has(key);
  }

  resolve(currency: string | null | undefined, at: Date): ResolvedRate | null {
    const key = normalizeCurrency(currency);
    if (key === BASE_CURRENCY) return implicitUsdRate();
    const list = this.byCurrency.get(key);
    if (!list || list.length === 0) return null;
    const t = at.getTime();
    // Binary search: last index with effectiveFrom <= t.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].effectiveFrom.getTime() <= t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const row = found >= 0 ? list[found] : list[0];
    return {
      rate: row.rateToUsd,
      effectiveFrom: row.effectiveFrom,
      usedEarliest: found < 0,
    };
  }
}

export interface ConvertibleEntry {
  currency: string | null | undefined;
  amount: number;
  count: number;
  /** null = no rate available -> unconverted. */
  rate: ResolvedRate | null;
}

export interface ConvertedRevenueByCurrencyItem extends RevenueByCurrencyItem {
  /** This currency's converted total in USD (rounded to 2 dp). */
  usdTotal: number;
  /** The most recent rate (by effectiveFrom) that was applied. */
  rateUsed: number;
}

export interface ConvertedRevenueSummary {
  baseCurrency: typeof BASE_CURRENCY;
  /** USD total of everything convertible; 0 when none. */
  totalRevenue: number;
  /** Informational: more than one currency is present. */
  mixedCurrencies: boolean;
  /** Original (unconverted) amounts per currency. */
  revenueByCurrency: RevenueByCurrencyItem[];
  convertedRevenueByCurrency: ConvertedRevenueByCurrencyItem[];
  unconvertedCurrencies: RevenueByCurrencyItem[];
  hasUnconvertedRevenue: boolean;
  usedEarliestRate: boolean;
}

export function summarizeConvertedRevenue(
  entries: readonly ConvertibleEntry[],
): ConvertedRevenueSummary {
  const original = summarizeRevenue(entries);

  interface Acc {
    total: number;
    transactions: number;
    usd: number;
    rateUsed: number;
    rateFrom: number;
  }
  const converted = new Map<string, Acc>();
  const unconverted = new Map<
    string,
    { total: number; transactions: number }
  >();
  let usedEarliestRate = false;

  for (const e of entries) {
    const key = normalizeCurrency(e.currency);
    if (!e.rate) {
      const u = unconverted.get(key) ?? { total: 0, transactions: 0 };
      u.total += e.amount;
      u.transactions += e.count;
      unconverted.set(key, u);
      continue;
    }
    if (e.rate.usedEarliest) usedEarliestRate = true;
    const acc = converted.get(key) ?? {
      total: 0,
      transactions: 0,
      usd: 0,
      rateUsed: e.rate.rate,
      rateFrom: Number.NEGATIVE_INFINITY,
    };
    acc.total += e.amount;
    acc.transactions += e.count;
    acc.usd += e.amount * e.rate.rate;
    const from = e.rate.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (from >= acc.rateFrom) {
      acc.rateFrom = from;
      acc.rateUsed = e.rate.rate;
    }
    converted.set(key, acc);
  }

  let usdSum = 0;
  const convertedRevenueByCurrency = [...converted.entries()]
    .map(([currency, a]) => {
      usdSum += a.usd;
      return {
        currency,
        total: roundMoney(a.total),
        transactions: a.transactions,
        usdTotal: roundMoney(a.usd),
        rateUsed: a.rateUsed,
      };
    })
    .sort(
      (a, b) => b.usdTotal - a.usdTotal || a.currency.localeCompare(b.currency),
    );

  const unconvertedCurrencies = [...unconverted.entries()]
    .map(([currency, u]) => ({
      currency,
      total: roundMoney(u.total),
      transactions: u.transactions,
    }))
    .sort((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));

  return {
    baseCurrency: BASE_CURRENCY,
    totalRevenue: roundMoney(usdSum),
    mixedCurrencies: original.mixedCurrencies,
    revenueByCurrency: original.revenueByCurrency,
    convertedRevenueByCurrency,
    unconvertedCurrencies,
    hasUnconvertedRevenue: unconvertedCurrencies.length > 0,
    usedEarliestRate,
  };
}

export interface DatedAmountRow {
  createdAt: Date;
  amount: number;
  currency: string | null;
}

export interface ConvertedBucket {
  /** Converted USD amount of everything convertible in this bucket (2 dp). */
  amount: number;
  /** Original per-currency amounts (kept as-is). */
  byCurrency: CurrencyTotals;
  /** Original amounts of currencies that had no rate (excluded from amount). */
  unconvertedByCurrency: CurrencyTotals;
  usedEarliestRate: boolean;
}

/**
 * Buckets rows by `keyOf` and converts each row at the rate effective on its
 * own createdAt. One pass, no per-row queries.
 */
export function bucketConvertedRevenue<T extends DatedAmountRow>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  table: FxRateTable,
): Map<string, ConvertedBucket> {
  const raw = new Map<string, { usd: number; bucket: ConvertedBucket }>();
  for (const row of rows) {
    const key = keyOf(row);
    let entry = raw.get(key);
    if (!entry) {
      entry = {
        usd: 0,
        bucket: {
          amount: 0,
          byCurrency: {},
          unconvertedByCurrency: {},
          usedEarliestRate: false,
        },
      };
      raw.set(key, entry);
    }
    addToCurrencyTotals(entry.bucket.byCurrency, row.currency, row.amount);
    const rate = table.resolve(row.currency, row.createdAt);
    if (!rate) {
      addToCurrencyTotals(
        entry.bucket.unconvertedByCurrency,
        row.currency,
        row.amount,
      );
      continue;
    }
    if (rate.usedEarliest) entry.bucket.usedEarliestRate = true;
    entry.usd += row.amount * rate.rate;
  }
  const out = new Map<string, ConvertedBucket>();
  for (const [key, { usd, bucket }] of raw) {
    bucket.amount = roundMoney(usd);
    out.set(key, bucket);
  }
  return out;
}

/** Re-export for callers that need the unknown-currency label. */
export { UNKNOWN_CURRENCY };
