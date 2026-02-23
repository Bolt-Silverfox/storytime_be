import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  AdminAnalyticsService,
  AiCreditDuration,
  UserGrowthDuration,
} from './admin-analytics.service';
import {
  ADMIN_ANALYTICS_REPOSITORY,
  IAdminAnalyticsRepository,
} from './repositories';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';

describe('AdminAnalyticsService', () => {
  let service: AdminAnalyticsService;
  let analyticsRepository: jest.Mocked<IAdminAnalyticsRepository>;
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  const mockDashboardStats = {
    totalUsers: 100,
    totalStories: 50,
    totalSubscriptions: 30,
    activeUsers: 80,
    usersTrend: { value: 10, label: 'up' as const },
    storiesTrend: { value: 5, label: 'up' as const },
    subscriptionsTrend: { value: 2, label: 'up' as const },
    activeUsersTrend: { value: 8, label: 'up' as const },
  };

  const mockStoryStats = {
    totalStories: 50,
    totalDuration: 15000,
    avgDuration: 300,
    aiGenerated: 30,
    humanCreated: 20,
    recommended: 10,
    storiesByLanguage: [{ language: 'en', count: 50 }],
    storiesByAgeGroup: [{ ageGroup: '4-8', count: 30 }],
  };

  const mockContentBreakdown = {
    categories: [{ name: 'Adventure', count: 15 }],
    themes: [{ name: 'Friendship', count: 20 }],
    languages: [{ name: 'en', count: 50 }],
  };

  const mockUserGrowth = [
    { date: '2025-01-01', totalUsers: 90, newUsers: 5 },
    { date: '2025-02-01', totalUsers: 100, newUsers: 10 },
  ];

  const mockSubscriptionAnalytics = {
    totalSubscriptions: 30,
    activeSubscriptions: 25,
    cancelledSubscriptions: 5,
    byPlan: [{ plan: 'premium', count: 20 }],
  };

  const mockRevenueAnalytics = {
    totalRevenue: 5000,
    monthlyRevenue: 500,
    revenueByPlan: [{ plan: 'premium', revenue: 4000 }],
  };

  const mockAiCreditAnalytics = {
    totalCreditsUsed: 1000,
    totalCreditsRemaining: 500,
    yearly: [
      { month: '2025-01-01', creditsUsed: 100 },
      { month: '2025-06-01', creditsUsed: 200 },
      { month: '2025-12-01', creditsUsed: 300 },
      { month: '2026-01-01', creditsUsed: 400 },
    ],
  };

  const mockUserGrowthMonthly = {
    data: [
      {
        labels: [
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
          'Jan',
          'Feb',
        ],
        freeUsers: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32],
        paidUsers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      },
    ],
  };

  beforeEach(async () => {
    const mockAdminAnalyticsRepository: Record<
      keyof IAdminAnalyticsRepository,
      jest.Mock
    > = {
      getDashboardStats: jest.fn(),
      getUserGrowth: jest.fn(),
      getStoryStats: jest.fn(),
      getContentBreakdown: jest.fn(),
      getSubscriptionAnalytics: jest.fn(),
      getRevenueAnalytics: jest.fn(),
      getAiCreditAnalytics: jest.fn(),
      getUserGrowthMonthly: jest.fn(),
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAnalyticsService,
        {
          provide: ADMIN_ANALYTICS_REPOSITORY,
          useValue: mockAdminAnalyticsRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AdminAnalyticsService>(AdminAnalyticsService);
    analyticsRepository = module.get(ADMIN_ANALYTICS_REPOSITORY);
    jest.clearAllMocks();
  });

  // =====================
  // getDashboardStats
  // =====================

  describe('getDashboardStats', () => {
    it('should return dashboard stats from repository and cache the result', async () => {
      analyticsRepository.getDashboardStats.mockResolvedValue(
        mockDashboardStats as any,
      );

      const result = await service.getDashboardStats();

      expect(result).toEqual(mockDashboardStats);
      expect(analyticsRepository.getDashboardStats).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.DASHBOARD_STATS,
        mockDashboardStats,
        CACHE_TTL_MS.DASHBOARD,
      );
    });

    it('should return cached data when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockDashboardStats);

      const result = await service.getDashboardStats();

      expect(result).toEqual(mockDashboardStats);
      expect(analyticsRepository.getDashboardStats).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });

  // =====================
  // getUserGrowth
  // =====================

  describe('getUserGrowth', () => {
    const dateRange = { startDate: '2025-01-01', endDate: '2025-12-31' };

    it('should return user growth data from repository', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue(
        mockUserGrowth as any,
      );

      const result = await service.getUserGrowth(dateRange);

      expect(result).toEqual(mockUserGrowth);
      expect(analyticsRepository.getUserGrowth).toHaveBeenCalledWith(dateRange);
      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    it('should return cached user growth when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockUserGrowth);

      const result = await service.getUserGrowth(dateRange);

      expect(result).toEqual(mockUserGrowth);
      expect(analyticsRepository.getUserGrowth).not.toHaveBeenCalled();
    });

    it('should return empty array when no data exists', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue([]);

      const result = await service.getUserGrowth(dateRange);

      expect(result).toEqual([]);
    });
  });

  // =====================
  // getStoryStats
  // =====================

  describe('getStoryStats', () => {
    it('should return story stats and cache the result', async () => {
      analyticsRepository.getStoryStats.mockResolvedValue(
        mockStoryStats as any,
      );

      const result = await service.getStoryStats();

      expect(result).toEqual(mockStoryStats);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.STORY_STATS,
        mockStoryStats,
        CACHE_TTL_MS.DASHBOARD,
      );
    });

    it('should return cached story stats when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockStoryStats);

      const result = await service.getStoryStats();

      expect(result).toEqual(mockStoryStats);
      expect(analyticsRepository.getStoryStats).not.toHaveBeenCalled();
    });
  });

  // =====================
  // getContentBreakdown
  // =====================

  describe('getContentBreakdown', () => {
    it('should return content breakdown and cache the result', async () => {
      analyticsRepository.getContentBreakdown.mockResolvedValue(
        mockContentBreakdown as any,
      );

      const result = await service.getContentBreakdown();

      expect(result).toEqual(mockContentBreakdown);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.CONTENT_BREAKDOWN,
        mockContentBreakdown,
        CACHE_TTL_MS.DASHBOARD,
      );
    });

    it('should return cached content breakdown when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockContentBreakdown);

      const result = await service.getContentBreakdown();

      expect(result).toEqual(mockContentBreakdown);
      expect(analyticsRepository.getContentBreakdown).not.toHaveBeenCalled();
    });
  });

  // =====================
  // getSystemHealth
  // =====================

  describe('getSystemHealth', () => {
    it('should return healthy status when database responds quickly', async () => {
      analyticsRepository.getDashboardStats.mockResolvedValue(
        mockDashboardStats as any,
      );

      const result = await service.getSystemHealth();

      expect(result.status).toBe('healthy');
      expect(result.database.connected).toBe(true);
      expect(result.database.responseTime).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.memoryUsage).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return down status when database throws', async () => {
      analyticsRepository.getDashboardStats.mockRejectedValue(
        new Error('Connection failed'),
      );

      const result = await service.getSystemHealth();

      expect(result.status).toBe('down');
      expect(result.database.connected).toBe(false);
      expect(result.memoryUsage.used).toBe(0);
      expect(result.memoryUsage.total).toBe(0);
      expect(result.memoryUsage.percentage).toBe(0);
    });
  });

  // =====================
  // getSubscriptionAnalytics
  // =====================

  describe('getSubscriptionAnalytics', () => {
    it('should return subscription analytics from repository', async () => {
      analyticsRepository.getSubscriptionAnalytics.mockResolvedValue(
        mockSubscriptionAnalytics as any,
      );

      const result = await service.getSubscriptionAnalytics();

      expect(result).toEqual(mockSubscriptionAnalytics);
      expect(analyticsRepository.getSubscriptionAnalytics).toHaveBeenCalledWith(
        undefined,
      );
    });

    it('should pass date range when provided', async () => {
      const dateRange = { startDate: '2025-01-01', endDate: '2025-06-30' };
      analyticsRepository.getSubscriptionAnalytics.mockResolvedValue(
        mockSubscriptionAnalytics as any,
      );

      await service.getSubscriptionAnalytics(dateRange);

      expect(analyticsRepository.getSubscriptionAnalytics).toHaveBeenCalledWith(
        dateRange,
      );
    });

    it('should return cached subscription analytics when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockSubscriptionAnalytics);

      const result = await service.getSubscriptionAnalytics();

      expect(result).toEqual(mockSubscriptionAnalytics);
      expect(
        analyticsRepository.getSubscriptionAnalytics,
      ).not.toHaveBeenCalled();
    });
  });

  // =====================
  // getRevenueAnalytics
  // =====================

  describe('getRevenueAnalytics', () => {
    it('should return revenue analytics from repository', async () => {
      analyticsRepository.getRevenueAnalytics.mockResolvedValue(
        mockRevenueAnalytics as any,
      );

      const result = await service.getRevenueAnalytics();

      expect(result).toEqual(mockRevenueAnalytics);
      expect(analyticsRepository.getRevenueAnalytics).toHaveBeenCalledWith(
        undefined,
      );
    });

    it('should pass date range when provided', async () => {
      const dateRange = { startDate: '2025-01-01' };
      analyticsRepository.getRevenueAnalytics.mockResolvedValue(
        mockRevenueAnalytics as any,
      );

      await service.getRevenueAnalytics(dateRange);

      expect(analyticsRepository.getRevenueAnalytics).toHaveBeenCalledWith(
        dateRange,
      );
    });

    it('should return cached revenue analytics when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockRevenueAnalytics);

      const result = await service.getRevenueAnalytics();

      expect(result).toEqual(mockRevenueAnalytics);
      expect(analyticsRepository.getRevenueAnalytics).not.toHaveBeenCalled();
    });
  });

  // =====================
  // getAiCreditAnalytics
  // =====================

  describe('getAiCreditAnalytics', () => {
    it('should return AI credit analytics without duration filter', async () => {
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue(
        mockAiCreditAnalytics as any,
      );

      const result = await service.getAiCreditAnalytics();

      expect(result).toEqual(mockAiCreditAnalytics);
      expect(analyticsRepository.getAiCreditAnalytics).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.AI_CREDIT_ANALYTICS,
        mockAiCreditAnalytics,
        CACHE_TTL_MS.DASHBOARD,
      );
    });

    it('should filter yearly data by daily duration', async () => {
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue({
        ...mockAiCreditAnalytics,
        yearly: [...mockAiCreditAnalytics.yearly],
      } as any);

      const result = await service.getAiCreditAnalytics('daily');

      // Daily cutoff filters out entries older than 1 day
      expect(result.yearly.length).toBeLessThanOrEqual(
        mockAiCreditAnalytics.yearly.length,
      );
    });

    it('should filter yearly data by monthly duration', async () => {
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue({
        ...mockAiCreditAnalytics,
        yearly: [...mockAiCreditAnalytics.yearly],
      } as any);

      const result = await service.getAiCreditAnalytics('monthly');

      expect(result.yearly).toBeDefined();
      expect(Array.isArray(result.yearly)).toBe(true);
    });

    it('should filter yearly data by quarterly duration', async () => {
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue({
        ...mockAiCreditAnalytics,
        yearly: [...mockAiCreditAnalytics.yearly],
      } as any);

      const result = await service.getAiCreditAnalytics('quarterly');

      expect(result.yearly).toBeDefined();
    });

    it('should filter yearly data by yearly duration', async () => {
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue({
        ...mockAiCreditAnalytics,
        yearly: [...mockAiCreditAnalytics.yearly],
      } as any);

      const result = await service.getAiCreditAnalytics('yearly');

      expect(result.yearly).toBeDefined();
    });

    it('should use duration-specific cache key when duration is provided', async () => {
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue({
        ...mockAiCreditAnalytics,
        yearly: [...mockAiCreditAnalytics.yearly],
      } as any);

      await service.getAiCreditAnalytics('weekly');

      expect(mockCacheManager.get).toHaveBeenCalledWith(
        `${CACHE_KEYS.AI_CREDIT_ANALYTICS}:weekly`,
      );
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        `${CACHE_KEYS.AI_CREDIT_ANALYTICS}:weekly`,
        expect.any(Object),
        CACHE_TTL_MS.DASHBOARD,
      );
    });

    it('should return cached data when available for duration', async () => {
      const cachedData = { ...mockAiCreditAnalytics, yearly: [] };
      mockCacheManager.get.mockResolvedValue(cachedData);

      const result = await service.getAiCreditAnalytics('monthly');

      expect(result).toEqual(cachedData);
      expect(analyticsRepository.getAiCreditAnalytics).not.toHaveBeenCalled();
    });

    it('should not filter when yearly is null/undefined', async () => {
      const dataWithoutYearly = {
        totalCreditsUsed: 1000,
        totalCreditsRemaining: 500,
        yearly: null,
      };
      analyticsRepository.getAiCreditAnalytics.mockResolvedValue(
        dataWithoutYearly as any,
      );

      const result = await service.getAiCreditAnalytics('monthly');

      // Should not throw when yearly is falsy
      expect(result.yearly).toBeNull();
    });
  });

  // =====================
  // getUserGrowthMonthly
  // =====================

  describe('getUserGrowthMonthly', () => {
    it('should return full 12-month data without duration filter', async () => {
      analyticsRepository.getUserGrowthMonthly.mockResolvedValue(
        mockUserGrowthMonthly as any,
      );

      const result = await service.getUserGrowthMonthly();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].labels).toHaveLength(12);
      expect(result.data[0].freeUsers).toHaveLength(12);
      expect(result.data[0].paidUsers).toHaveLength(12);
    });

    it('should filter to last 1 month for last_month duration', async () => {
      analyticsRepository.getUserGrowthMonthly.mockResolvedValue({
        data: [
          {
            labels: [...mockUserGrowthMonthly.data[0].labels],
            freeUsers: [...mockUserGrowthMonthly.data[0].freeUsers],
            paidUsers: [...mockUserGrowthMonthly.data[0].paidUsers],
          },
        ],
      } as any);

      const result = await service.getUserGrowthMonthly('last_month');

      expect(result.data[0].labels).toHaveLength(1);
      expect(result.data[0].labels[0]).toBe('Feb');
      expect(result.data[0].freeUsers).toHaveLength(1);
      expect(result.data[0].freeUsers[0]).toBe(32);
    });

    it('should filter to last 1 month for last_week duration', async () => {
      analyticsRepository.getUserGrowthMonthly.mockResolvedValue({
        data: [
          {
            labels: [...mockUserGrowthMonthly.data[0].labels],
            freeUsers: [...mockUserGrowthMonthly.data[0].freeUsers],
            paidUsers: [...mockUserGrowthMonthly.data[0].paidUsers],
          },
        ],
      } as any);

      const result = await service.getUserGrowthMonthly('last_week');

      expect(result.data[0].labels).toHaveLength(1);
    });

    it('should return all 12 months for last_year duration', async () => {
      analyticsRepository.getUserGrowthMonthly.mockResolvedValue({
        data: [
          {
            labels: [...mockUserGrowthMonthly.data[0].labels],
            freeUsers: [...mockUserGrowthMonthly.data[0].freeUsers],
            paidUsers: [...mockUserGrowthMonthly.data[0].paidUsers],
          },
        ],
      } as any);

      const result = await service.getUserGrowthMonthly('last_year');

      expect(result.data[0].labels).toHaveLength(12);
    });

    it('should return cached data when available', async () => {
      mockCacheManager.get.mockResolvedValue(mockUserGrowthMonthly);

      const result = await service.getUserGrowthMonthly();

      expect(result).toEqual(mockUserGrowthMonthly);
      expect(analyticsRepository.getUserGrowthMonthly).not.toHaveBeenCalled();
    });

    it('should use duration-specific cache key', async () => {
      analyticsRepository.getUserGrowthMonthly.mockResolvedValue({
        data: [
          {
            labels: [...mockUserGrowthMonthly.data[0].labels],
            freeUsers: [...mockUserGrowthMonthly.data[0].freeUsers],
            paidUsers: [...mockUserGrowthMonthly.data[0].paidUsers],
          },
        ],
      } as any);

      await service.getUserGrowthMonthly('last_month');

      expect(mockCacheManager.get).toHaveBeenCalledWith(
        `${CACHE_KEYS.USER_GROWTH_MONTHLY}:last_month`,
      );
    });

    it('should handle empty data array', async () => {
      analyticsRepository.getUserGrowthMonthly.mockResolvedValue({
        data: [],
      } as any);

      const result = await service.getUserGrowthMonthly('last_month');

      expect(result.data).toEqual([]);
    });
  });

  // =====================
  // exportAnalyticsData
  // =====================

  describe('exportAnalyticsData', () => {
    it('should export users data as JSON', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue(
        mockUserGrowth as any,
      );

      const result = await service.exportAnalyticsData('users', 'json');

      expect(result.contentType).toBe('application/json');
      expect(JSON.parse(result.data)).toEqual(mockUserGrowth);
    });

    it('should export users data as CSV', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue(
        mockUserGrowth as any,
      );

      const result = await service.exportAnalyticsData('users', 'csv');

      expect(result.contentType).toBe('text/csv');
      expect(result.data).toContain('date');
      expect(result.data).toContain('totalUsers');
      expect(result.data).toContain('newUsers');
    });

    it('should export revenue data as JSON', async () => {
      analyticsRepository.getRevenueAnalytics.mockResolvedValue(
        mockRevenueAnalytics as any,
      );

      const result = await service.exportAnalyticsData('revenue', 'json');

      expect(result.contentType).toBe('application/json');
      expect(JSON.parse(result.data)).toEqual(mockRevenueAnalytics);
    });

    it('should export subscriptions data as JSON', async () => {
      analyticsRepository.getSubscriptionAnalytics.mockResolvedValue(
        mockSubscriptionAnalytics as any,
      );

      const result = await service.exportAnalyticsData('subscriptions', 'json');

      expect(result.contentType).toBe('application/json');
      expect(JSON.parse(result.data)).toEqual(mockSubscriptionAnalytics);
    });

    it('should default to CSV format when not specified', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue(
        mockUserGrowth as any,
      );

      const result = await service.exportAnalyticsData('users');

      expect(result.contentType).toBe('text/csv');
    });

    it('should pass date range to repository when provided', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue([] as any);

      await service.exportAnalyticsData(
        'users',
        'csv',
        '2025-01-01',
        '2025-12-31',
      );

      expect(analyticsRepository.getUserGrowth).toHaveBeenCalledWith({
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });
    });

    it('should handle empty array data for CSV export', async () => {
      analyticsRepository.getUserGrowth.mockResolvedValue([] as any);

      const result = await service.exportAnalyticsData('users', 'csv');

      // convertToCsv returns empty string for empty arrays
      expect(result.contentType).toBe('text/csv');
    });

    it('should export revenue object data as CSV with Section,Key,Value headers', async () => {
      analyticsRepository.getRevenueAnalytics.mockResolvedValue(
        mockRevenueAnalytics as any,
      );

      const result = await service.exportAnalyticsData('revenue', 'csv');

      expect(result.contentType).toBe('text/csv');
      expect(result.data).toContain('Section,Key,Value');
    });
  });
});
