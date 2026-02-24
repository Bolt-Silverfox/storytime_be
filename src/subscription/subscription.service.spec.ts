import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SUBSCRIPTION_STATUS } from './subscription.constants';
import { CacheMetricsService } from '@/shared/services/cache-metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Type-safe mock for PrismaService
type MockPrismaService = {
  subscription: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  paymentTransaction: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const createMockPrismaService = (): MockPrismaService => ({
  subscription: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  paymentTransaction: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

const createMockCacheMetrics = () => ({
  getOrSet: jest.fn(),
  del: jest.fn(),
});

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockPrisma: MockPrismaService;
  let mockCacheMetrics: ReturnType<typeof createMockCacheMetrics>;

  const mockSubscription = {
    id: 'sub-1',
    userId: 'user-1',
    plan: 'monthly',
    status: SUBSCRIPTION_STATUS.ACTIVE,
    startedAt: new Date(),
    endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockCacheMetrics = createMockCacheMetrics();

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheMetricsService, useValue: mockCacheMetrics },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== GET PLANS TESTS ====================

  describe('getPlans', () => {
    it('should return all available plans', () => {
      const plans = service.getPlans();

      expect(plans).toBeDefined();
      expect(plans.free).toBeDefined();
      expect(plans.weekly).toBeDefined();
      expect(plans.monthly).toBeDefined();
      expect(plans.yearly).toBeDefined();
    });

    it('should have correct plan structure', () => {
      const plans = service.getPlans();

      expect(plans.free).toEqual({
        display: 'Free',
        amount: 0,
        days: 365 * 100,
      });
      expect(plans.monthly.amount).toBe(4.99);
      expect(plans.monthly.days).toBe(30);
    });
  });

  // ==================== GET SUBSCRIPTION FOR USER TESTS ====================

  describe('getSubscriptionForUser', () => {
    it('should return user subscription', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(mockSubscription);

      const result = await service.getSubscriptionForUser('user-1');

      expect(result).toEqual(mockSubscription);
      expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should return null if user has no subscription', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      const result = await service.getSubscriptionForUser('user-1');

      expect(result).toBeNull();
    });
  });

  // ==================== SUBSCRIBE TESTS ====================

  describe('subscribe', () => {
    it('should subscribe user to free plan successfully', async () => {
      const createdSub = {
        ...mockSubscription,
        plan: 'free',
        status: SUBSCRIPTION_STATUS.ACTIVE,
      };

      // $transaction executes the callback with a prisma tx client
      mockPrisma.$transaction.mockImplementation((cb: Function) => {
        const txClient = {
          subscription: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdSub),
            update: jest.fn(),
          },
        };
        return cb(txClient);
      });
      mockCacheMetrics.del.mockResolvedValue(undefined);

      const result = await service.subscribe('user-1', 'free');

      expect(result.subscription).toBeDefined();
      expect(result.subscription.plan).toBe('free');
    });

    it('should throw BadRequestException for invalid plan', async () => {
      await expect(service.subscribe('user-1', 'invalid-plan')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for paid plans', async () => {
      await expect(service.subscribe('user-1', 'monthly')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.subscribe('user-1', 'yearly')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.subscribe('user-1', 'weekly')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update existing subscription for free plan', async () => {
      const updatedSub = {
        ...mockSubscription,
        plan: 'free',
        status: SUBSCRIPTION_STATUS.ACTIVE,
      };

      mockPrisma.$transaction.mockImplementation((cb: Function) => {
        const txClient = {
          subscription: {
            findFirst: jest.fn().mockResolvedValue(mockSubscription),
            create: jest.fn(),
            update: jest.fn().mockResolvedValue(updatedSub),
          },
        };
        return cb(txClient);
      });
      mockCacheMetrics.del.mockResolvedValue(undefined);

      const result = await service.subscribe('user-1', 'free');

      expect(result.subscription).toBeDefined();
      expect(result.subscription.plan).toBe('free');
    });
  });

  // ==================== CANCEL SUBSCRIPTION TESTS ====================

  describe('cancel', () => {
    it('should cancel subscription successfully', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(mockSubscription);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSubscription,
        status: SUBSCRIPTION_STATUS.CANCELLED,
      });

      const result = await service.cancel('user-1');

      expect(result.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: mockSubscription.id },
        data: expect.objectContaining({
          status: SUBSCRIPTION_STATUS.CANCELLED,
        }),
      });
    });

    it('should throw NotFoundException if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancel('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should keep existing endsAt if in future', async () => {
      const futureEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const subscriptionWithFutureEnd = {
        ...mockSubscription,
        endsAt: futureEndsAt,
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(
        subscriptionWithFutureEnd,
      );
      mockPrisma.subscription.update.mockResolvedValue({
        ...subscriptionWithFutureEnd,
        status: SUBSCRIPTION_STATUS.CANCELLED,
      });

      await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: mockSubscription.id },
        data: expect.objectContaining({
          endsAt: futureEndsAt,
        }),
      });
    });

    it('should set endsAt to now if already expired', async () => {
      const pastEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const subscriptionWithPastEnd = {
        ...mockSubscription,
        endsAt: pastEndsAt,
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(
        subscriptionWithPastEnd,
      );

      const beforeCall = Date.now();
      mockPrisma.subscription.update.mockImplementation(({ data }) => {
        // Should set endsAt to approximately now (not the past date)
        expect(data.endsAt.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
        return Promise.resolve({
          ...subscriptionWithPastEnd,
          status: SUBSCRIPTION_STATUS.CANCELLED,
          endsAt: data.endsAt,
        });
      });

      await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });
  });

  // ==================== LIST HISTORY TESTS ====================

  describe('listHistory', () => {
    it('should return payment transaction history', async () => {
      const transactions = [
        {
          id: 'tx-1',
          userId: 'user-1',
          amount: 4.99,
          currency: 'USD',
          status: 'success',
          createdAt: new Date(),
        },
        {
          id: 'tx-2',
          userId: 'user-1',
          amount: 4.99,
          currency: 'USD',
          status: 'success',
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      ];
      mockPrisma.paymentTransaction.findMany.mockResolvedValue(transactions);

      const result = await service.listHistory('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.paymentTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array if no transactions', async () => {
      mockPrisma.paymentTransaction.findMany.mockResolvedValue([]);

      const result = await service.listHistory('user-1');

      expect(result).toEqual([]);
    });
  });

  // ==================== EDGE CASES ====================

  describe('edge cases', () => {
    it('should handle subscription with null endsAt on cancel', async () => {
      const subscriptionWithNullEnd = {
        ...mockSubscription,
        endsAt: null,
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(
        subscriptionWithNullEnd,
      );

      const beforeCall = Date.now();
      mockPrisma.subscription.update.mockImplementation(({ data }) => {
        // Should set endsAt to now when existing is null
        expect(data.endsAt.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
        return Promise.resolve({
          ...subscriptionWithNullEnd,
          status: SUBSCRIPTION_STATUS.CANCELLED,
          endsAt: data.endsAt,
        });
      });

      await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });
  });
});
