/**
 * Currency-safe revenue helpers. There is NO FX conversion anywhere: amounts in
 * different currencies are never added together. A sum is only exposed as a
 * single number when every contributing amount shares one currency; otherwise
 * it is `null` and the per-currency breakdown carries the figures.
 */

/** Bucket for transactions whose currency is null / blank. */
export const UNKNOWN_CURRENCY = 'UNKNOWN';

export type CurrencyTotals = Record<string, number>;

export interface CurrencyRevenueEntry {
  currency: string | null | undefined;
  amount: number;
  count: number;
}

export interface RevenueByCurrencyItem {
  currency: string;
  total: number;
  transactions: number;
}

export interface RevenueSummary {
  /** Plain sum when single-currency (or empty -> 0); null when mixed. */
  totalRevenue: number | null;
  mixedCurrencies: boolean;
  /** Sorted by total desc (ties by currency code). */
  revenueByCurrency: RevenueByCurrencyItem[];
}

export const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** 'ngn' / ' NGN ' -> 'NGN'; null / blank -> 'UNKNOWN'. */
export function normalizeCurrency(currency: string | null | undefined) {
  const c = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return c || UNKNOWN_CURRENCY;
}

/** Adds `amount` to `totals[currency]` (currency normalized, result rounded to cents). */
export function addToCurrencyTotals(
  totals: CurrencyTotals,
  currency: string | null | undefined,
  amount: number,
) {
  const key = normalizeCurrency(currency);
  totals[key] = roundMoney((totals[key] ?? 0) + amount);
}

/**
 * The plain number for a per-currency map: 0 when empty, the value when there
 * is exactly one currency, `null` when there are several.
 */
export function singleCurrencyTotal(totals: CurrencyTotals): number | null {
  const keys = Object.keys(totals);
  if (keys.length === 0) return 0;
  if (keys.length === 1) return roundMoney(totals[keys[0]]);
  return null;
}

export function summarizeRevenue(
  entries: readonly CurrencyRevenueEntry[],
): RevenueSummary {
  const byCurrency = new Map<string, { total: number; transactions: number }>();
  for (const e of entries) {
    const key = normalizeCurrency(e.currency);
    const cur = byCurrency.get(key) ?? { total: 0, transactions: 0 };
    cur.total += e.amount;
    cur.transactions += e.count;
    byCurrency.set(key, cur);
  }
  const revenueByCurrency = [...byCurrency.entries()]
    .map(([currency, v]) => ({
      currency,
      total: roundMoney(v.total),
      transactions: v.transactions,
    }))
    .sort((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));

  return {
    totalRevenue:
      revenueByCurrency.length === 0
        ? 0
        : revenueByCurrency.length === 1
          ? revenueByCurrency[0].total
          : null,
    mixedCurrencies: revenueByCurrency.length > 1,
    revenueByCurrency,
  };
}
