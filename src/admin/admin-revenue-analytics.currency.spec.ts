import { Test, TestingModule } from '@nestjs/testing';
import { AdminRevenueAnalyticsService } from './admin-revenue-analytics.service';
import { AdminFxRateService } from './admin-fx-rate.service';
import {
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';
import { FxRateTable } from './utils/fx-conversion.util';

const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
const d = (s: string) => new Date(`${s}T10:00:00.000Z`);
const usd = { rate: 1, effectiveFrom: null, usedEarliest: false };
const ngnRate = {
  rate: 0.00065,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  usedEarliest: false,
};

describe('AdminRevenueAnalyticsService FX conversion', () => {
  let service: AdminRevenueAnalyticsService;
  let paymentRepo: Record<string, jest.Mock>;
  let table: FxRateTable;

  beforeEach(async () => {
    table = new FxRateTable([
      {
        currency: 'NGN',
        rateToUsd: 0.00065,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    paymentRepo = {
      findSuccessfulInRange: jest.fn().mockResolvedValue([]),
      groupRevenueByPlan: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminRevenueAnalyticsService,
        {
          provide: ADMIN_SUBSCRIPTION_REPOSITORY,
          useValue: {
            count: jest.fn().mockResolvedValue(0),
            groupByStartedAt: jest.fn().mockResolvedValue([]),
            groupByActivePlan: jest.fn().mockResolvedValue([]),
            groupByActiveSource: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: paymentRepo },
        { provide: ADMIN_ACTIVITY_REPOSITORY, useValue: {} },
        {
          provide: AdminFxRateService,
          useValue: { getRateTable: jest.fn(() => Promise.resolve(table)) },
        },
      ],
    }).compile();
    service = module.get(AdminRevenueAnalyticsService);
  });

  it('empty scope: totalRevenue 0 USD, nothing unconverted', async () => {
    const r = await service.getRevenueAnalytics(range);
    expect(r).toMatchObject({
      baseCurrency: 'USD',
      totalRevenue: 0,
      mixedCurrencies: false,
      revenueByCurrency: [],
      convertedRevenueByCurrency: [],
      unconvertedCurrencies: [],
      hasUnconvertedRevenue: false,
      usedEarliestRate: false,
      dailyRevenue: [],
    });
  });

  it('single currency (USD) is unchanged, with byCurrency kept', async () => {
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 4.99, currency: 'USD', createdAt: d('2026-10-01') },
      { amount: 47.99, currency: 'USD', createdAt: d('2026-10-02') },
    ]);
    paymentRepo.groupRevenueByPlan.mockResolvedValue([
      { plan: 'monthly', currency: 'USD', amount: 4.99, count: 1, rate: usd },
      { plan: 'yearly', currency: 'USD', amount: 47.99, count: 1, rate: usd },
    ]);

    const r = await service.getRevenueAnalytics(range);

    expect(r.totalRevenue).toBe(52.98);
    expect(r.mixedCurrencies).toBe(false);
    expect(r.revenueByCurrency).toEqual([
      { currency: 'USD', total: 52.98, transactions: 2 },
    ]);
    expect(r.dailyRevenue).toEqual([
      expect.objectContaining({
        date: '2026-10-01',
        amount: 4.99,
        byCurrency: { USD: 4.99 },
      }),
      expect.objectContaining({
        date: '2026-10-02',
        amount: 47.99,
        byCurrency: { USD: 47.99 },
      }),
    ]);
    expect(r.monthlyRevenue[0]).toMatchObject({
      month: '2026-10',
      total_amount: 52.98,
      byCurrency: { USD: 52.98 },
    });
    expect(r.yearlyRevenue[0]).toMatchObject({
      year: '2026',
      total_amount: 52.98,
    });
    expect(r.topPlans.map((p) => [p.plan, p.total_revenue])).toEqual([
      ['yearly', 47.99],
      ['monthly', 4.99],
    ]);
  });

  it('mixed currencies are converted to USD in total, series and plans', async () => {
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 4500, currency: 'NGN', createdAt: d('2026-10-01') },
      { amount: 9.99, currency: 'USD', createdAt: d('2026-10-01') },
      { amount: 10000, currency: 'ngn', createdAt: d('2026-10-02') },
    ]);
    paymentRepo.groupRevenueByPlan.mockResolvedValue([
      {
        plan: 'monthly',
        currency: 'NGN',
        amount: 14500,
        count: 2,
        rate: ngnRate,
      },
      { plan: 'monthly', currency: 'USD', amount: 9.99, count: 1, rate: usd },
      { plan: 'yearly', currency: 'USD', amount: 40, count: 1, rate: usd },
    ]);

    const r = await service.getRevenueAnalytics(range);

    // 4500*.00065 + 9.99 + 10000*.00065 = 2.925 + 9.99 + 6.5 = 19.415 -> 19.42
    expect(r.totalRevenue).toBe(19.42);
    expect(r.mixedCurrencies).toBe(true);
    expect(r.hasUnconvertedRevenue).toBe(false);
    expect(r.revenueByCurrency).toEqual([
      { currency: 'NGN', total: 14500, transactions: 2 },
      { currency: 'USD', total: 9.99, transactions: 1 },
    ]);
    expect(r.convertedRevenueByCurrency).toEqual([
      {
        currency: 'USD',
        total: 9.99,
        transactions: 1,
        usdTotal: 9.99,
        rateUsed: 1,
      },
      {
        currency: 'NGN',
        total: 14500,
        transactions: 2,
        usdTotal: 9.43,
        rateUsed: 0.00065,
      },
    ]);
    expect(r.dailyRevenue).toEqual([
      expect.objectContaining({
        date: '2026-10-01',
        amount: 12.92,
        byCurrency: { NGN: 4500, USD: 9.99 },
      }),
      expect.objectContaining({
        date: '2026-10-02',
        amount: 6.5,
        byCurrency: { NGN: 10000 },
      }),
    ]);
    expect(r.monthlyRevenue[0]).toMatchObject({
      total_amount: 19.42,
      byCurrency: { NGN: 14500, USD: 9.99 },
    });
    expect(r.yearlyRevenue[0].total_amount).toBe(19.42);
    expect(r.topPlans.find((p) => p.plan === 'monthly')).toMatchObject({
      total_revenue: 19.42,
      byCurrency: { NGN: 14500, USD: 9.99 },
      transactions: 3,
    });
    expect(r.topPlans.find((p) => p.plan === 'yearly')).toMatchObject({
      total_revenue: 40,
    });
    // top plans are ranked by converted revenue, comparable now
    expect(r.topPlans[0].plan).toBe('yearly');
  });

  it('currency without a rate is excluded and reported as unconverted everywhere', async () => {
    table = new FxRateTable([]);
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 4500, currency: 'NGN', createdAt: d('2026-10-01') },
      { amount: 9.99, currency: 'USD', createdAt: d('2026-10-01') },
    ]);
    paymentRepo.groupRevenueByPlan.mockResolvedValue([
      { plan: 'monthly', currency: 'NGN', amount: 4500, count: 1, rate: null },
      { plan: 'monthly', currency: 'USD', amount: 9.99, count: 1, rate: usd },
    ]);
    const r = await service.getRevenueAnalytics(range);
    expect(r.totalRevenue).toBe(9.99);
    expect(r.hasUnconvertedRevenue).toBe(true);
    expect(r.unconvertedCurrencies).toEqual([
      { currency: 'NGN', total: 4500, transactions: 1 },
    ]);
    expect(r.dailyRevenue[0]).toMatchObject({
      amount: 9.99,
      byCurrency: { NGN: 4500, USD: 9.99 },
      unconvertedByCurrency: { NGN: 4500 },
    });
    expect(r.topPlans[0]).toMatchObject({
      total_revenue: 9.99,
      unconvertedByCurrency: { NGN: 4500 },
    });
  });

  it('uses the rate effective on each transaction date and flags the earliest-rate fallback', async () => {
    table = new FxRateTable([
      { currency: 'NGN', rateToUsd: 0.001, effectiveFrom: d('2026-10-10') },
      { currency: 'NGN', rateToUsd: 0.0005, effectiveFrom: d('2026-10-20') },
    ]);
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 1000, currency: 'NGN', createdAt: d('2026-10-05') }, // earliest fallback
      { amount: 1000, currency: 'NGN', createdAt: d('2026-10-15') },
      { amount: 1000, currency: 'NGN', createdAt: d('2026-10-25') },
    ]);
    const r = await service.getRevenueAnalytics(range);
    expect(r.usedEarliestRate).toBe(true);
    expect(r.dailyRevenue.map((p) => p.amount)).toEqual([1, 1, 0.5]);
    expect(r.totalRevenue).toBe(2.5);
  });

  it('subscription analytics revenueGrowth uses the same converted per-day amounts', async () => {
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 5000, currency: 'NGN', createdAt: d('2026-10-01') },
      { amount: 5, currency: 'USD', createdAt: d('2026-10-01') },
      { amount: 5, currency: 'USD', createdAt: d('2026-10-02') },
    ]);
    const r = await service.getSubscriptionAnalytics(range);
    expect(r.revenueGrowth).toEqual([
      expect.objectContaining({
        date: '2026-10-01',
        amount: 8.25,
        byCurrency: { NGN: 5000, USD: 5 },
      }),
      expect.objectContaining({
        date: '2026-10-02',
        amount: 5,
        byCurrency: { USD: 5 },
      }),
    ]);
  });
});
