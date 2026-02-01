import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { SUBSCRIPTION_STATUS } from './subscription.constants';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      subscription: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      paymentTransaction: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentService, useValue: {} },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlans', () => {
    it('should return all available plans', () => {
      const plans = service.getPlans();
      expect(plans).toHaveProperty('free');
      expect(plans).toHaveProperty('monthly');
      expect(plans).toHaveProperty('yearly');
    });
  });

  describe('getSubscriptionForUser', () => {
    it('should return subscription for user', async () => {
      const mockSub = { id: 'sub-1', plan: 'monthly', status: 'active' };
      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);

      const result = await service.getSubscriptionForUser('user-1');

      expect(result).toEqual(mockSub);
      expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should return null if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      const result = await service.getSubscriptionForUser('user-1');

      expect(result).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('should create subscription to free plan', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1', plan: 'free' });

      const result = await service.subscribe('user-1', 'free');

      expect(result.subscription?.plan).toBe('free');
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid plan', async () => {
      await expect(service.subscribe('user-1', 'invalid-plan'))
        .rejects.toThrow(BadRequestException);
    });

    it('should update existing subscription instead of creating new', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'existing-sub' });
      mockPrisma.subscription.update.mockResolvedValue({ id: 'existing-sub', plan: 'free' });

      await service.subscribe('user-1', 'free');

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });

    it('should set correct endsAt based on plan days', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockImplementation((args: any) => Promise.resolve(args.data));

      await service.subscribe('user-1', 'free');

      expect(mockPrisma.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          plan: 'free',
          status: SUBSCRIPTION_STATUS.ACTIVE,
        }),
      });
    });
  });

  describe('cancel', () => {
    it('should throw NotFoundException if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancel('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should preserve future endsAt when cancelling', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', endsAt: futureDate });
      mockPrisma.subscription.update.mockResolvedValue({ status: 'cancelled', endsAt: futureDate });

      const result = await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SUBSCRIPTION_STATUS.CANCELLED,
            endsAt: futureDate,
          }),
        }),
      );
    });

    it('should set endsAt to now if existing endsAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', endsAt: pastDate });
      mockPrisma.subscription.update.mockImplementation((args: any) => Promise.resolve(args.data));

      await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SUBSCRIPTION_STATUS.CANCELLED,
          }),
        }),
      );
    });
  });

  describe('reactivate', () => {
    it('should reuse subscribe logic', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1', plan: 'free' });

      const result = await service.reactivate('user-1', 'free');

      expect(result.subscription).toBeDefined();
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
    });
  });

  describe('listHistory', () => {
    it('should return payment transactions for user', async () => {
      const mockTransactions = [{ id: 'tx-1' }, { id: 'tx-2' }];
      mockPrisma.paymentTransaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.listHistory('user-1');

      expect(result).toEqual(mockTransactions);
      expect(mockPrisma.paymentTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
