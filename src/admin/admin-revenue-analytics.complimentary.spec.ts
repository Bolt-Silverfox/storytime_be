import { Test, TestingModule } from '@nestjs/testing';
import { AdminRevenueAnalyticsService } from './admin-revenue-analytics.service';
import {
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';

describe('AdminRevenueAnalyticsService complimentary vs paying', () => {
  let service: AdminRevenueAnalyticsService;
  let subscriptionRepo: {
    count: jest.Mock;
    groupByStartedAt: jest.Mock;
    groupByActivePlan: jest.Mock;
    groupByActiveSource: jest.Mock;
  };
  let paymentRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    subscriptionRepo = {
      count: jest.fn().mockResolvedValue(0),
      groupByStartedAt: jest.fn().mockResolvedValue([]),
      // Distinguish the three call shapes by the extra where
      groupByActivePlan: jest.fn((_now: Date, extra?: Record<string, any>) => {
        if (extra?.source === 'store')
          return Promise.resolve([{ plan: 'monthly', _count: 3 }]);
        if (extra?.source?.not === 'store')
          return Promise.resolve([{ plan: 'yearly', _count: 2 }]);
        return Promise.resolve([
          { plan: 'monthly', _count: 3 },
          { plan: 'yearly', _count: 2 },
        ]);
      }),
      groupByActiveSource: jest.fn().mockResolvedValue([
        { source: 'store', _count: 3 },
        { source: 'admin_grant', _count: 2 },
      ]),
    };
    paymentRepo = {
      groupRevenueByCreatedAt: jest.fn().mockResolvedValue([]),
      groupRevenueByCreatedAtOrdered: jest.fn().mockResolvedValue([]),
      findSuccessfulInRange: jest.fn().mockResolvedValue([]),
      groupRevenueByPlan: jest.fn().mockResolvedValue([
        {
          plan: 'monthly',
          currency: 'USD',
          _sum: { amount: 14.97 },
          _count: 3,
        },
      ]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminRevenueAnalyticsService,
        { provide: ADMIN_SUBSCRIPTION_REPOSITORY, useValue: subscriptionRepo },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: paymentRepo },
        { provide: ADMIN_ACTIVITY_REPOSITORY, useValue: {} },
      ],
    }).compile();
    service = module.get(AdminRevenueAnalyticsService);
  });

  it('subscription analytics adds paying/complimentary breakdowns and keeps legacy fields', async () => {
    const r = await service.getSubscriptionAnalytics({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    // legacy: all active access, unchanged
    expect(r.planBreakdown).toEqual([
      { plan: 'monthly', count: 3 },
      { plan: 'yearly', count: 2 },
    ]);
    expect(r.paying).toMatchObject({
      activeSubscriptions: 3,
      planBreakdown: [{ plan: 'monthly', count: 3 }],
    });
    expect(r.complimentary).toMatchObject({
      activeSubscriptions: 2,
      planBreakdown: [{ plan: 'yearly', count: 2 }],
      bySource: [{ source: 'admin_grant', count: 2 }],
    });
  });

  it('churn is computed over store subscriptions only', async () => {
    await service.getSubscriptionAnalytics({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    for (const [where] of subscriptionRepo.count.mock.calls) {
      expect(where).toMatchObject({ source: 'store' });
    }
    expect(subscriptionRepo.count).toHaveBeenCalledTimes(2);
  });

  it('paying growth series is filtered to store', async () => {
    await service.getSubscriptionAnalytics({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(subscriptionRepo.groupByStartedAt).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      { source: 'store', plan: { not: 'free' } },
    );
  });

  it('revenue analytics top-plan subscription_count counts paying subscriptions only', async () => {
    const r = await service.getRevenueAnalytics({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    const monthly = r.topPlans.find((p) => p.plan === 'monthly');
    const yearly = r.topPlans.find((p) => p.plan === 'yearly');
    expect(monthly).toMatchObject({
      subscription_count: 3,
      total_revenue: 14.97,
    });
    // comped yearly access contributes neither revenue nor a paying subscription
    expect(yearly?.subscription_count ?? 0).toBe(0);
  });

  it('churn / paying counts exclude plan=free rows', async () => {
    await service.getSubscriptionAnalytics({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    for (const [where] of subscriptionRepo.count.mock.calls) {
      expect(where.plan).toEqual({ not: 'free' });
    }
    // paying growth + plan breakdown calls carry the same fragment
    expect(subscriptionRepo.groupByStartedAt).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      { source: 'store', plan: { not: 'free' } },
    );
  });
});
