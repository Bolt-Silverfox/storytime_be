import {
  FxRateTable,
  bucketConvertedRevenue,
  summarizeConvertedRevenue,
} from './fx-conversion.util';

const d = (s: string) => new Date(s);
const NGN_OLD = {
  id: 'r1',
  currency: 'NGN',
  rateToUsd: 0.001,
  effectiveFrom: d('2026-01-01T00:00:00Z'),
};
const NGN_NEW = {
  id: 'r2',
  currency: 'NGN',
  rateToUsd: 0.0005,
  effectiveFrom: d('2026-06-01T00:00:00Z'),
};

describe('FxRateTable.resolve', () => {
  const table = new FxRateTable([NGN_NEW, NGN_OLD]); // unsorted on purpose

  it('USD is implicit rate 1', () => {
    expect(table.resolve('USD', d('2020-01-01'))).toEqual({
      rate: 1,
      effectiveFrom: null,
      usedEarliest: false,
    });
    expect(table.resolve(' usd ', d('2020-01-01'))?.rate).toBe(1);
  });

  it('picks the latest rate effective at or before the transaction date', () => {
    expect(table.resolve('NGN', d('2026-03-01'))?.rate).toBe(0.001);
    expect(table.resolve('ngn', d('2026-06-01T00:00:00Z'))?.rate).toBe(0.0005);
    expect(table.resolve('NGN', d('2026-05-31T23:59:59.999Z'))?.rate).toBe(
      0.001,
    );
    expect(table.resolve('NGN', d('2026-09-01'))).toMatchObject({
      rate: 0.0005,
      usedEarliest: false,
    });
  });

  it('falls back to the earliest rate (flagged) before any rate is effective', () => {
    expect(table.resolve('NGN', d('2025-01-01'))).toEqual({
      rate: 0.001,
      effectiveFrom: NGN_OLD.effectiveFrom,
      usedEarliest: true,
    });
  });

  it('returns null for a currency with no rate at all (never guess)', () => {
    expect(table.resolve('GHS', d('2026-03-01'))).toBeNull();
    expect(table.resolve(null, d('2026-03-01'))).toBeNull();
    expect(table.resolve('', d('2026-03-01'))).toBeNull();
  });
});

describe('summarizeConvertedRevenue', () => {
  const ngn = {
    rate: 0.00065,
    effectiveFrom: d('2026-01-01'),
    usedEarliest: false,
  };
  const usd = { rate: 1, effectiveFrom: null, usedEarliest: false };

  it('converts mixed currencies and rounds to 2dp only at the end', () => {
    const s = summarizeConvertedRevenue([
      { currency: 'NGN', amount: 4500, count: 1, rate: ngn },
      { currency: 'USD', amount: 9.99, count: 1, rate: usd },
    ]);
    // 4500*0.00065 + 9.99 = 12.915 -> 12.92
    expect(s.baseCurrency).toBe('USD');
    expect(s.totalRevenue).toBe(12.92);
    expect(s.mixedCurrencies).toBe(true);
    expect(s.hasUnconvertedRevenue).toBe(false);
    expect(s.usedEarliestRate).toBe(false);
    expect(s.unconvertedCurrencies).toEqual([]);
    expect(s.revenueByCurrency).toEqual([
      { currency: 'NGN', total: 4500, transactions: 1 },
      { currency: 'USD', total: 9.99, transactions: 1 },
    ]);
    expect(s.convertedRevenueByCurrency).toEqual([
      {
        currency: 'USD',
        total: 9.99,
        transactions: 1,
        usdTotal: 9.99,
        rateUsed: 1,
      },
      {
        currency: 'NGN',
        total: 4500,
        transactions: 1,
        usdTotal: 2.93,
        rateUsed: 0.00065,
      },
    ]);
  });

  it('does not round intermediate per-entry values', () => {
    // three entries of 0.004 USD each: per-entry rounding would give 0, sum 0.012 -> 0.01
    const entries = [0, 1, 2].map(() => ({
      currency: 'NGN',
      amount: 4,
      count: 1,
      rate: {
        rate: 0.001,
        effectiveFrom: d('2026-01-01'),
        usedEarliest: false,
      },
    }));
    expect(summarizeConvertedRevenue(entries).totalRevenue).toBe(0.01);
  });

  it('lists a currency without a rate as unconverted and excludes it from the total', () => {
    const s = summarizeConvertedRevenue([
      { currency: 'NGN', amount: 4500, count: 3, rate: null },
      { currency: 'USD', amount: 10, count: 1, rate: usd },
    ]);
    expect(s.totalRevenue).toBe(10);
    expect(s.hasUnconvertedRevenue).toBe(true);
    expect(s.unconvertedCurrencies).toEqual([
      { currency: 'NGN', total: 4500, transactions: 3 },
    ]);
    expect(s.convertedRevenueByCurrency.map((c) => c.currency)).toEqual([
      'USD',
    ]);
  });

  it('is 0 / empty with no entries, and all-unconverted gives total 0', () => {
    const empty = summarizeConvertedRevenue([]);
    expect(empty).toMatchObject({
      totalRevenue: 0,
      mixedCurrencies: false,
      hasUnconvertedRevenue: false,
      revenueByCurrency: [],
    });
    const only = summarizeConvertedRevenue([
      { currency: null, amount: 5, count: 1, rate: null },
    ]);
    expect(only.totalRevenue).toBe(0);
    expect(only.unconvertedCurrencies).toEqual([
      { currency: 'UNKNOWN', total: 5, transactions: 1 },
    ]);
  });

  it('flags usedEarliestRate and reports the latest effective rate as rateUsed', () => {
    const s = summarizeConvertedRevenue([
      {
        currency: 'NGN',
        amount: 1000,
        count: 1,
        rate: {
          rate: 0.001,
          effectiveFrom: d('2026-01-01'),
          usedEarliest: true,
        },
      },
      {
        currency: 'NGN',
        amount: 1000,
        count: 1,
        rate: {
          rate: 0.0005,
          effectiveFrom: d('2026-06-01'),
          usedEarliest: false,
        },
      },
    ]);
    expect(s.usedEarliestRate).toBe(true);
    expect(s.totalRevenue).toBe(1.5);
    expect(s.convertedRevenueByCurrency[0]).toMatchObject({
      currency: 'NGN',
      total: 2000,
      transactions: 2,
      usdTotal: 1.5,
      rateUsed: 0.0005,
    });
  });
});

describe('bucketConvertedRevenue', () => {
  const table = new FxRateTable([NGN_OLD, NGN_NEW]);

  it('converts each row at its own date and keeps original byCurrency', () => {
    const buckets = bucketConvertedRevenue(
      [
        { createdAt: d('2026-03-10T10:00:00Z'), amount: 1000, currency: 'NGN' },
        { createdAt: d('2026-03-10T11:00:00Z'), amount: 5, currency: 'usd' },
        { createdAt: d('2026-07-01T11:00:00Z'), amount: 1000, currency: 'NGN' },
        { createdAt: d('2026-07-01T12:00:00Z'), amount: 3, currency: 'GHS' },
      ],
      (r) => r.createdAt.toISOString().slice(0, 10),
      table,
    );
    expect(buckets.get('2026-03-10')).toMatchObject({
      amount: 6,
      byCurrency: { NGN: 1000, USD: 5 },
    });
    expect(buckets.get('2026-07-01')).toMatchObject({
      amount: 0.5,
      byCurrency: { NGN: 1000, GHS: 3 },
      unconvertedByCurrency: { GHS: 3 },
    });
  });

  it('handles a huge set without per-row cost blowups', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => ({
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      amount: 1,
      currency: i % 2 ? 'NGN' : 'USD',
    }));
    const t0 = Date.now();
    const b = bucketConvertedRevenue(rows, () => 'all', table);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(b.get('all')?.byCurrency).toEqual({ NGN: 100000, USD: 100000 });
  });
});
