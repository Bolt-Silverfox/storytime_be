import {
  UNKNOWN_CURRENCY,
  normalizeCurrency,
  singleCurrencyTotal,
  summarizeRevenue,
  addToCurrencyTotals,
} from './revenue-currency.util';

describe('revenue-currency.util', () => {
  it('normalizes currency codes; null / blank become UNKNOWN', () => {
    expect(normalizeCurrency('ngn')).toBe('NGN');
    expect(normalizeCurrency(' usd ')).toBe('USD');
    expect(normalizeCurrency(null)).toBe(UNKNOWN_CURRENCY);
    expect(normalizeCurrency(undefined)).toBe(UNKNOWN_CURRENCY);
    expect(normalizeCurrency('  ')).toBe(UNKNOWN_CURRENCY);
  });

  it('addToCurrencyTotals accumulates per normalized currency, rounded to cents', () => {
    const t: Record<string, number> = {};
    addToCurrencyTotals(t, 'usd', 0.1);
    addToCurrencyTotals(t, 'USD', 0.2);
    addToCurrencyTotals(t, null, 5);
    expect(t).toEqual({ USD: 0.3, UNKNOWN: 5 });
  });

  describe('singleCurrencyTotal', () => {
    it('is 0 when empty', () => expect(singleCurrencyTotal({})).toBe(0));
    it('is the plain value for one currency', () =>
      expect(singleCurrencyTotal({ NGN: 1500.5 })).toBe(1500.5));
    it('is null for more than one currency', () =>
      expect(singleCurrencyTotal({ NGN: 1500, USD: 5 })).toBeNull());
  });

  describe('summarizeRevenue', () => {
    it('empty scope -> total 0, not mixed, no breakdown', () => {
      expect(summarizeRevenue([])).toEqual({
        totalRevenue: 0,
        mixedCurrencies: false,
        revenueByCurrency: [],
      });
    });

    it('single currency -> plain sum', () => {
      expect(
        summarizeRevenue([
          { currency: 'USD', amount: 4.99, count: 1 },
          { currency: 'usd', amount: 47.99, count: 2 },
        ]),
      ).toEqual({
        totalRevenue: 52.98,
        mixedCurrencies: false,
        revenueByCurrency: [{ currency: 'USD', total: 52.98, transactions: 3 }],
      });
    });

    it('mixed -> null total, sorted by total desc, UNKNOWN grouped', () => {
      expect(
        summarizeRevenue([
          { currency: 'USD', amount: 52.98, count: 3 },
          { currency: 'NGN', amount: 25000, count: 5 },
          { currency: null, amount: 100, count: 1 },
        ]),
      ).toEqual({
        totalRevenue: null,
        mixedCurrencies: true,
        revenueByCurrency: [
          { currency: 'NGN', total: 25000, transactions: 5 },
          { currency: 'UNKNOWN', total: 100, transactions: 1 },
          { currency: 'USD', total: 52.98, transactions: 3 },
        ],
      });
    });

    it('a lone UNKNOWN group is a single currency bucket (plain sum)', () => {
      const r = summarizeRevenue([{ currency: null, amount: 9, count: 1 }]);
      expect(r.totalRevenue).toBe(9);
      expect(r.mixedCurrencies).toBe(false);
      expect(r.revenueByCurrency).toEqual([
        { currency: 'UNKNOWN', total: 9, transactions: 1 },
      ]);
    });
  });
});
