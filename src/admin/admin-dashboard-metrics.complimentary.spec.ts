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

describe('AdminDashboardMetricsService complimentary vs paying', () => {
  let service: AdminDashboardMetricsService;

  // 100 users; 10 hold active access: 6 store (paying), 4 non-store (comped).
  const subscriptionCount = jest.fn((where: Record<string, any>) => {
    const isActive = where.status === 'active';
    if (!isActive) return Promise.resolve(10);
    if (where.source === 'store') return Promise.resolve(6);
    if (where.source?.not === 'store') return Promise.resolve(4);
    return Promise.resolve(10);
  });
  const sumRevenue = jest
    .fn()
    .mockResolvedValue([{ currency: 'USD', amount: 29.94, count: 6 }]);
  const users = [
    {
      createdAt: new Date('2026-10-01'),
      subscription: { status: 'active', source: 'store' },
    },
    {
      createdAt: new Date('2026-10-01'),
      subscription: { status: 'active', source: 'admin_grant' },
    },
    { createdAt: new Date('2026-10-01'), subscription: null },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardMetricsService,
        {
          provide: ADMIN_USER_REPOSITORY,
          useValue: {
            count: jest.fn().mockResolvedValue(100),
            findManyWithSubscription: jest.fn().mockResolvedValue(users),
            findManyForGrowthMonthly: jest.fn().mockResolvedValue(users),
          },
        },
        {
          provide: ADMIN_SUBSCRIPTION_REPOSITORY,
          useValue: {
            count: subscriptionCount,
            groupByActivePlan: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ADMIN_PAYMENT_REPOSITORY,
          useValue: { sumRevenueByCurrency: sumRevenue },
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

  it('paidUsers and conversionRate count only store subscriptions; comped are reported separately', async () => {
    const s = await service.getDashboardStats();

    expect(s.paidUsers).toBe(6);
    expect(s.complimentaryUsers).toBe(4);
    // users with no access at all
    expect(s.unpaidUsers).toBe(100 - 6 - 4);
    expect(s.conversionRate).toBe(6);
    // access-based figure is unchanged (everyone with access)
    expect(s.activeSubscriptions).toBe(10);
    expect(s.payingSubscriptions).toBe(6);
    expect(s.complimentarySubscriptions).toBe(4);
  });

  it('revenue is transaction-based and is not filtered by subscription source', async () => {
    const s = await service.getDashboardStats();
    expect(s.totalRevenue).toBe(29.94);
    expect(sumRevenue).toHaveBeenCalledWith(
      expect.not.objectContaining({ source: expect.anything() }),
    );
  });

  it('user growth counts comped users separately from paying ones', async () => {
    const g = await service.getUserGrowth({
      startDate: '2026-09-01',
      endDate: '2026-10-30',
    });
    expect(g[0]).toMatchObject({
      newUsers: 3,
      paidUsers: 1,
      complimentaryUsers: 1,
    });
  });

  it('monthly growth splits paying / complimentary / free', async () => {
    const m = await service.getUserGrowthMonthly('yearly' as never);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(m.data.paidUsers)).toBe(1);
    expect(sum(m.data.complimentaryUsers)).toBe(1);
    expect(sum(m.data.freeUsers)).toBe(1);
  });

  describe('free-plan rows are not counted as paying', () => {
    it('every subscription count excludes plan=free (paid, active, total)', async () => {
      await service.getDashboardStats();
      expect(subscriptionCount.mock.calls.length).toBeGreaterThan(0);
      for (const [where] of subscriptionCount.mock.calls) {
        expect(where.plan).toEqual({ not: 'free' });
      }
    });

    it('a user on an active free-plan row is neither paying nor complimentary in growth series', async () => {
      const freeUser = {
        createdAt: new Date('2026-10-01'),
        subscription: { status: 'active', source: 'store', plan: 'free' },
      };
      const userRepo = (service as any).userRepo;
      userRepo.findManyWithSubscription.mockResolvedValue([freeUser]);
      userRepo.findManyForGrowthMonthly.mockResolvedValue([freeUser]);

      const g = await service.getUserGrowth({
        startDate: '2026-09-01',
        endDate: '2026-10-30',
      });
      expect(g[0]).toMatchObject({
        newUsers: 1,
        paidUsers: 0,
        complimentaryUsers: 0,
      });

      const m = await service.getUserGrowthMonthly('yearly' as never);
      const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
      expect(sum(m.data.paidUsers)).toBe(0);
      expect(sum(m.data.complimentaryUsers)).toBe(0);
      expect(sum(m.data.freeUsers)).toBe(1);
    });

    it('cumulative baseline user counts use the paying / complimentary filters (which exclude free)', async () => {
      await service.getUserGrowth({
        startDate: '2026-09-01',
        endDate: '2026-10-30',
      });
      const userRepo = (service as any).userRepo;
      const subWheres = userRepo.count.mock.calls
        .map(([w]: [any]) => w.subscription)
        .filter(Boolean);
      expect(subWheres.length).toBe(2);
      for (const w of subWheres) expect(w.plan).toEqual({ not: 'free' });
    });
  });
});
