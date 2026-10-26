import { Test, TestingModule } from '@nestjs/testing';
import { AdminRevenueAnalyticsService } from './admin-revenue-analytics.service';
import {
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';

const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
const d = (s: string) => new Date(`${s}T10:00:00.000Z`);

describe('AdminRevenueAnalyticsService currency handling', () => {
  let service: AdminRevenueAnalyticsService;
  let paymentRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    paymentRepo = {
      groupRevenueByCreatedAt: jest.fn().mockResolvedValue([]),
      groupRevenueByCreatedAtOrdered: jest.fn().mockResolvedValue([]),
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
      ],
    }).compile();
    service = module.get(AdminRevenueAnalyticsService);
  });

  it('empty scope: totalRevenue 0, not mixed, empty breakdown', async () => {
    const r = await service.getRevenueAnalytics(range);
    expect(r.totalRevenue).toBe(0);
    expect(r.mixedCurrencies).toBe(false);
    expect(r.revenueByCurrency).toEqual([]);
    expect(r.dailyRevenue).toEqual([]);
  });

  it('single currency: plain sums everywhere (backward compatible numbers) plus byCurrency', async () => {
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 4.99, currency: 'USD', createdAt: d('2026-10-01') },
      { amount: 47.99, currency: 'USD', createdAt: d('2026-10-02') },
    ]);
    paymentRepo.groupRevenueByCreatedAtOrdered.mockResolvedValue([
      { createdAt: d('2026-10-01'), byCurrency: { USD: 4.99 } },
      { createdAt: d('2026-10-02'), byCurrency: { USD: 47.99 } },
    ]);
    paymentRepo.groupRevenueByPlan.mockResolvedValue([
      { plan: 'monthly', currency: 'USD', _sum: { amount: 4.99 }, _count: 1 },
      { plan: 'yearly', currency: 'USD', _sum: { amount: 47.99 }, _count: 1 },
    ]);

    const r = await service.getRevenueAnalytics(range);

    expect(r.totalRevenue).toBe(52.98);
    expect(r.mixedCurrencies).toBe(false);
    expect(r.revenueByCurrency).toEqual([
      { currency: 'USD', total: 52.98, transactions: 2 },
    ]);
    expect(r.dailyRevenue).toEqual([
      { date: '2026-10-01', amount: 4.99, byCurrency: { USD: 4.99 } },
      { date: '2026-10-02', amount: 47.99, byCurrency: { USD: 47.99 } },
    ]);
    expect(r.monthlyRevenue).toEqual([
      { month: '2026-10', total_amount: 52.98, byCurrency: { USD: 52.98 } },
    ]);
    expect(r.yearlyRevenue).toEqual([
      { year: '2026', total_amount: 52.98, byCurrency: { USD: 52.98 } },
    ]);
    expect(r.topPlans).toEqual([
      {
        plan: 'yearly',
        subscription_count: 0,
        total_revenue: 47.99,
        byCurrency: { USD: 47.99 },
        transactions: 1,
      },
      {
        plan: 'monthly',
        subscription_count: 0,
        total_revenue: 4.99,
        byCurrency: { USD: 4.99 },
        transactions: 1,
      },
    ]);
  });

  it('mixed currencies: totals/series amounts are null, never a cross-currency sum', async () => {
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 5000, currency: 'NGN', createdAt: d('2026-10-01') },
      { amount: 20000, currency: 'NGN', createdAt: d('2026-10-01') },
      { amount: 4.99, currency: 'USD', createdAt: d('2026-10-01') },
      { amount: 47.99, currency: 'USD', createdAt: d('2026-10-02') },
      { amount: 3, currency: null, createdAt: d('2026-10-02') },
    ]);
    paymentRepo.groupRevenueByCreatedAtOrdered.mockResolvedValue([
      { createdAt: d('2026-10-01'), byCurrency: { NGN: 25000, USD: 4.99 } },
      { createdAt: d('2026-10-02'), byCurrency: { USD: 47.99, UNKNOWN: 3 } },
    ]);
    paymentRepo.groupRevenueByPlan.mockResolvedValue([
      { plan: 'monthly', currency: 'NGN', _sum: { amount: 25000 }, _count: 2 },
      { plan: 'monthly', currency: 'USD', _sum: { amount: 4.99 }, _count: 1 },
      { plan: 'yearly', currency: 'USD', _sum: { amount: 47.99 }, _count: 1 },
    ]);

    const r = await service.getRevenueAnalytics(range);

    expect(r.totalRevenue).toBeNull();
    expect(r.mixedCurrencies).toBe(true);
    expect(r.revenueByCurrency).toEqual([
      { currency: 'NGN', total: 25000, transactions: 2 },
      { currency: 'USD', total: 52.98, transactions: 2 },
      { currency: 'UNKNOWN', total: 3, transactions: 1 },
    ]);
    expect(r.dailyRevenue).toEqual([
      {
        date: '2026-10-01',
        amount: null,
        byCurrency: { NGN: 25000, USD: 4.99 },
      },
      {
        date: '2026-10-02',
        amount: null,
        byCurrency: { USD: 47.99, UNKNOWN: 3 },
      },
    ]);
    expect(r.monthlyRevenue[0]).toEqual({
      month: '2026-10',
      total_amount: null,
      byCurrency: { NGN: 25000, USD: 52.98, UNKNOWN: 3 },
    });
    expect(r.yearlyRevenue[0].total_amount).toBeNull();
    const monthly = r.topPlans.find((p) => p.plan === 'monthly');
    expect(monthly).toMatchObject({
      total_revenue: null,
      byCurrency: { NGN: 25000, USD: 4.99 },
      transactions: 3,
    });
    // yearly is USD-only: its own plain sum is still meaningful
    expect(r.topPlans.find((p) => p.plan === 'yearly')).toMatchObject({
      total_revenue: 47.99,
    });
    // sanity: no field anywhere holds the cross-currency sum 25000+52.98+3
    expect(JSON.stringify(r)).not.toContain('25055.98');
  });

  it('a single day can be single-currency even when the whole range is mixed', async () => {
    paymentRepo.findSuccessfulInRange.mockResolvedValue([
      { amount: 5000, currency: 'NGN', createdAt: d('2026-10-01') },
      { amount: 4.99, currency: 'USD', createdAt: d('2026-10-02') },
    ]);
    paymentRepo.groupRevenueByCreatedAtOrdered.mockResolvedValue([
      { createdAt: d('2026-10-01'), byCurrency: { NGN: 5000 } },
      { createdAt: d('2026-10-02'), byCurrency: { USD: 4.99 } },
    ]);
    const r = await service.getRevenueAnalytics(range);
    expect(r.totalRevenue).toBeNull();
    expect(r.dailyRevenue.map((p) => p.amount)).toEqual([5000, 4.99]);
  });

  it('subscription analytics revenueGrowth follows the same per-day rule', async () => {
    paymentRepo.groupRevenueByCreatedAt.mockResolvedValue([
      { createdAt: d('2026-10-01'), byCurrency: { NGN: 5000, USD: 5 } },
      { createdAt: d('2026-10-02'), byCurrency: { USD: 5 } },
    ]);
    const r = await service.getSubscriptionAnalytics(range);
    expect(r.revenueGrowth).toEqual([
      { date: '2026-10-01', amount: null, byCurrency: { NGN: 5000, USD: 5 } },
      { date: '2026-10-02', amount: 5, byCurrency: { USD: 5 } },
    ]);
  });
});
