import { Test, TestingModule } from '@nestjs/testing';
import { AdminRevenueAnalyticsService } from './admin-revenue-analytics.service';
import {
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';

describe('AdminRevenueAnalyticsService — churn rate', () => {
  let service: AdminRevenueAnalyticsService;
  let subscriptionRepo: {
    count: jest.Mock;
    groupByStartedAt: jest.Mock;
    groupByActivePlan: jest.Mock;
  };
  let paymentRepo: { groupRevenueByCreatedAt: jest.Mock };

  const range = { startDate: '2026-07-01', endDate: '2026-07-31' };

  beforeEach(async () => {
    subscriptionRepo = {
      count: jest.fn(),
      groupByStartedAt: jest.fn().mockResolvedValue([]),
      groupByActivePlan: jest.fn().mockResolvedValue([]),
    };
    paymentRepo = { groupRevenueByCreatedAt: jest.fn().mockResolvedValue([]) };

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

  it('scopes the churn base and the churned count to the window via endsAt', async () => {
    // count() is called twice: first the base (denominator), then the churned
    // (numerator).
    subscriptionRepo.count.mockResolvedValueOnce(200); // base
    subscriptionRepo.count.mockResolvedValueOnce(10); // churned in window

    const result = await service.getSubscriptionAnalytics(range);

    const [baseWhere] = subscriptionRepo.count.mock.calls[0];
    const [churnedWhere] = subscriptionRepo.count.mock.calls[1];

    // Base: started before the window and still had access at the window start.
    expect(baseWhere.startedAt).toEqual({ lt: new Date(range.startDate) });
    expect(baseWhere.OR).toEqual([
      { endsAt: null },
      { endsAt: { gte: new Date(range.startDate) } },
    ]);

    // Churned: cancelled subs from that base whose access ended inside the window.
    expect(churnedWhere.startedAt).toEqual({ lt: new Date(range.startDate) });
    expect(churnedWhere.status).toBe('cancelled');
    // Date-only endDate is inclusive through the whole day, not just midnight.
    expect(churnedWhere.endsAt).toEqual({
      gte: new Date(range.startDate),
      lte: new Date(`${range.endDate}T23:59:59.999Z`),
    });

    expect(result.churnRate).toBe(5); // 10 / 200 * 100
  });

  it('keeps an explicit endDate timestamp unchanged', async () => {
    subscriptionRepo.count.mockResolvedValueOnce(200);
    subscriptionRepo.count.mockResolvedValueOnce(10);

    const explicitEnd = '2026-07-31T12:30:00.000Z';
    await service.getSubscriptionAnalytics({
      startDate: range.startDate,
      endDate: explicitEnd,
    });

    const [churnedWhere] = subscriptionRepo.count.mock.calls[1];
    expect(churnedWhere.endsAt.lte).toEqual(new Date(explicitEnd));
  });

  it('never exceeds 100% even when every base subscriber churned', async () => {
    // The numerator is a strict subset of the denominator, so churn is bounded.
    subscriptionRepo.count.mockResolvedValueOnce(50); // base
    subscriptionRepo.count.mockResolvedValueOnce(50); // all of them churned

    const result = await service.getSubscriptionAnalytics(range);

    expect(result.churnRate).toBe(100);
    expect(result.churnRate).toBeLessThanOrEqual(100);
  });

  it('returns 0 churn when there is no starting base (no divide-by-zero)', async () => {
    subscriptionRepo.count.mockResolvedValueOnce(0); // base
    subscriptionRepo.count.mockResolvedValueOnce(3); // churned (should be ignored)

    const result = await service.getSubscriptionAnalytics(range);

    expect(result.churnRate).toBe(0);
  });
});
