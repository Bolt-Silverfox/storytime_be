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

describe('AdminDashboardMetricsService totalRevenue FX conversion', () => {
  let service: AdminDashboardMetricsService;
  const sumRevenueWithRates = jest.fn();

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
          useValue: { sumRevenueWithRates },
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

  const usd = { rate: 1, effectiveFrom: null, usedEarliest: false };
  const ngn = {
    rate: 0.00065,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    usedEarliest: false,
  };

  it('no transactions -> 0 USD, nothing unconverted', async () => {
    sumRevenueWithRates.mockResolvedValue([]);
    const s = await service.getDashboardStats();
    expect(s.baseCurrency).toBe('USD');
    expect(s.totalRevenue).toBe(0);
    expect(s.mixedCurrencies).toBe(false);
    expect(s.revenueByCurrency).toEqual([]);
    expect(s.convertedRevenueByCurrency).toEqual([]);
    expect(s.unconvertedCurrencies).toEqual([]);
    expect(s.hasUnconvertedRevenue).toBe(false);
    expect(s.usedEarliestRate).toBe(false);
  });

  it('single currency (USD) is unchanged; trend still computed', async () => {
    sumRevenueWithRates
      .mockResolvedValueOnce([
        { currency: 'USD', amount: 120, count: 4, rate: usd },
      ])
      .mockResolvedValueOnce([
        { currency: 'USD', amount: 100, count: 3, rate: usd },
      ]);
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

  it('mixed currencies are converted to USD (NGN 4500 + USD 9.99 -> 12.92)', async () => {
    sumRevenueWithRates
      .mockResolvedValueOnce([
        { currency: 'NGN', amount: 4500, count: 1, rate: ngn },
        { currency: 'USD', amount: 9.99, count: 1, rate: usd },
      ])
      .mockResolvedValueOnce([
        { currency: 'NGN', amount: 4500, count: 1, rate: ngn },
      ]);
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBe(12.92);
    expect(s.mixedCurrencies).toBe(true);
    expect(s.hasUnconvertedRevenue).toBe(false);
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
    // previous month converted total is 2.925 -> 2.93; trend is vs converted prev
    expect(s.performanceMetrics.totalRevenue).toMatchObject({
      value: 12.92,
      direction: 'up',
    });
  });

  it('a currency with no rate is listed as unconverted and excluded from the total', async () => {
    sumRevenueWithRates
      .mockResolvedValueOnce([
        { currency: 'NGN', amount: 25000, count: 5, rate: null },
        { currency: 'USD', amount: 52.98, count: 3, rate: usd },
      ])
      .mockResolvedValueOnce([]);
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBe(52.98);
    expect(s.hasUnconvertedRevenue).toBe(true);
    expect(s.unconvertedCurrencies).toEqual([
      { currency: 'NGN', total: 25000, transactions: 5 },
    ]);
  });

  it('flags usedEarliestRate when a payment predates the earliest rate', async () => {
    sumRevenueWithRates
      .mockResolvedValueOnce([
        {
          currency: 'NGN',
          amount: 1000,
          count: 1,
          rate: { ...ngn, usedEarliest: true },
        },
      ])
      .mockResolvedValueOnce([]);
    const s = await service.getDashboardStats();
    expect(s.usedEarliestRate).toBe(true);
    expect(s.totalRevenue).toBe(0.65);
  });
});
