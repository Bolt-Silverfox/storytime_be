import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminDashboardMetricsService } from './admin-dashboard-metrics.service';
import {
  ADMIN_USER_REPOSITORY,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_STORY_REPOSITORY,
  ADMIN_CONTENT_REPOSITORY,
  ADMIN_ENGAGEMENT_REPOSITORY,
} from './repositories';

describe('AdminDashboardMetricsService totalRevenue currency handling', () => {
  let service: AdminDashboardMetricsService;
  const sumRevenueByCurrency = jest.fn();

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardMetricsService,
        {
          provide: ADMIN_USER_REPOSITORY,
          useValue: { count: jest.fn().mockResolvedValue(10) },
        },
        {
          provide: ADMIN_SUBSCRIPTION_REPOSITORY,
          useValue: {
            count: jest.fn().mockResolvedValue(0),
            groupByActivePlan: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ADMIN_PAYMENT_REPOSITORY,
          useValue: { sumRevenueByCurrency },
        },
        {
          provide: ADMIN_STORY_REPOSITORY,
          useValue: { countStories: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: ADMIN_CONTENT_REPOSITORY,
          useValue: {
            countCategories: jest.fn().mockResolvedValue(0),
            countThemes: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: ADMIN_ENGAGEMENT_REPOSITORY,
          useValue: {
            countKids: jest.fn().mockResolvedValue(0),
            countStoryProgress: jest.fn().mockResolvedValue(0),
            countFavorites: jest.fn().mockResolvedValue(0),
            getAverageSessionSeconds: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(AdminDashboardMetricsService);
  });

  it('no transactions -> 0, not mixed', async () => {
    sumRevenueByCurrency.mockResolvedValue([]);
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBe(0);
    expect(s.mixedCurrencies).toBe(false);
    expect(s.revenueByCurrency).toEqual([]);
  });

  it('single currency -> plain total plus breakdown; trend still computed', async () => {
    sumRevenueByCurrency
      .mockResolvedValueOnce([{ currency: 'USD', amount: 120, count: 4 }])
      .mockResolvedValueOnce([{ currency: 'USD', amount: 100, count: 3 }]);
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBe(120);
    expect(s.mixedCurrencies).toBe(false);
    expect(s.revenueByCurrency).toEqual([
      { currency: 'USD', total: 120, transactions: 4 },
    ]);
    expect(s.performanceMetrics.totalRevenue).toMatchObject({
      value: 120,
      trend: 20,
      direction: 'up',
    });
  });

  it('mixed currencies -> totalRevenue null, never a cross-currency sum; no fake trend', async () => {
    sumRevenueByCurrency
      .mockResolvedValueOnce([
        { currency: 'NGN', amount: 25000, count: 5 },
        { currency: 'USD', amount: 52.98, count: 3 },
      ])
      .mockResolvedValueOnce([{ currency: 'NGN', amount: 20000, count: 4 }]);
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBeNull();
    expect(s.mixedCurrencies).toBe(true);
    expect(s.revenueByCurrency).toEqual([
      { currency: 'NGN', total: 25000, transactions: 5 },
      { currency: 'USD', total: 52.98, transactions: 3 },
    ]);
    expect(s.performanceMetrics.totalRevenue).toMatchObject({
      value: null,
      trend: 0,
      direction: 'neutral',
    });
  });

  it('single currency now but a different currency last month -> no trend (cannot compare)', async () => {
    sumRevenueByCurrency
      .mockResolvedValueOnce([{ currency: 'USD', amount: 50, count: 1 }])
      .mockResolvedValueOnce([{ currency: 'NGN', amount: 20000, count: 4 }]);
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBe(50);
    expect(s.performanceMetrics.totalRevenue).toMatchObject({
      value: 50,
      trend: 0,
      direction: 'neutral',
    });
  });
});
