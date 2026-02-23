import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { SubscriptionService } from '@/subscription/subscription.service';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Type-safe mock for PrismaService
type MockPrismaService = {
  paymentTransaction: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  subscription: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};

const createMockPrismaService = (): MockPrismaService => {
  const svc: MockPrismaService = {
    paymentTransaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // $transaction delegates to a callback with the same mock models
  svc.$transaction.mockImplementation((fn) =>
    fn({
      paymentTransaction: svc.paymentTransaction,
      subscription: svc.subscription,
    }),
  );
  return svc;
};

describe('PaymentService', () => {
  let service: PaymentService;
  let mockPrisma: MockPrismaService;
  let mockGoogleVerification: {
    verify: jest.Mock;
    cancelSubscription: jest.Mock;
    acknowledgePurchase: jest.Mock;
  };
  let mockAppleVerification: {
    verify: jest.Mock;
    getSubscriptionStatus: jest.Mock;
  };
  let mockConfigService: { get: jest.Mock };
  let mockSubscriptionService: { invalidateCache: jest.Mock };
  let mockEventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockGoogleVerification = {
      verify: jest.fn(),
      cancelSubscription: jest.fn(),
      acknowledgePurchase: jest.fn().mockResolvedValue({ success: true }),
    };
    mockAppleVerification = {
      verify: jest.fn(),
      getSubscriptionStatus: jest.fn(),
    };
    mockConfigService = { get: jest.fn() };
    mockSubscriptionService = { invalidateCache: jest.fn() };
    mockEventEmitter = { emit: jest.fn() };

    jest.clearAllMocks();

    mockPrisma.paymentTransaction.findFirst.mockResolvedValue(null);
    mockSubscriptionService.invalidateCache.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        {
          provide: GoogleVerificationService,
          useValue: mockGoogleVerification,
        },
        { provide: AppleVerificationService, useValue: mockAppleVerification },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyPurchase', () => {
    it('should verify Google purchase and create subscription', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'valid-token',
      };
      const now = new Date();

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        platformTxId: 'GPA.1234',
        amount: 4.99,
        currency: 'USD',
        expirationTime: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });

      mockPrisma.paymentTransaction.create.mockResolvedValue({
        id: 'tx-1',
        userId,
        paymentMethodId: null,
        amount: 4.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-123',
      });
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({
        id: 'sub-1',
        userId,
        plan: 'monthly',
        status: 'active',
        startedAt: now,
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });

      const result = await service.verifyPurchase(userId, dto);

      expect(mockGoogleVerification.verify).toHaveBeenCalledWith({
        purchaseToken: 'valid-token',
        productId: 'com.storytime.monthly',
        packageName: undefined,
      });
      expect(mockPrisma.paymentTransaction.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.subscription?.plan).toBe('monthly');
    });

    it('should verify Apple purchase and create subscription', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'apple' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'transaction-id-123',
      };
      const now = new Date();

      mockAppleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        platformTxId: 'apple-tx-123',
        originalTxId: 'apple-tx-123',
        amount: 4.99,
        currency: 'USD',
        expirationTime: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });

      mockPrisma.paymentTransaction.create.mockResolvedValue({
        id: 'tx-1',
        userId,
        paymentMethodId: null,
        amount: 4.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-456',
      });
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({
        id: 'sub-1',
        userId,
        plan: 'monthly',
        status: 'active',
        startedAt: now,
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });

      const result = await service.verifyPurchase(userId, dto);

      expect(mockAppleVerification.verify).toHaveBeenCalledWith({
        transactionId: 'transaction-id-123',
        productId: 'com.storytime.monthly',
      });
      expect(result.success).toBe(true);
    });

    it('should handle duplicate Google receipt (idempotency)', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'duplicate-token',
      };

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
      });

      mockPrisma.paymentTransaction.findFirst.mockResolvedValue({
        id: 'tx-existing',
        userId: 'user-1',
        status: 'success',
        reference: 'existing-hash',
      });

      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        startedAt: new Date(),
        endsAt: new Date(),
      });

      const result = await service.verifyPurchase(userId, dto);

      expect(mockPrisma.paymentTransaction.create).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect((result as { alreadyProcessed?: boolean }).alreadyProcessed).toBe(
        true,
      );
    });

    it('should reject receipt reuse from different user', async () => {
      const userId = 'user-2';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'reused-token',
      };

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
      });

      // Existing transaction belongs to a different user
      mockPrisma.paymentTransaction.findFirst.mockResolvedValue({
        id: 'tx-existing',
        userId: 'user-1',
        status: 'success',
        reference: 'existing-hash',
      });

      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        'This purchase receipt has already been used by another account',
      );
    });

    it('should throw BadRequestException for unsupported platform', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'unsupported' as 'google',
        productId: 'test',
        purchaseToken: 'token',
      };

      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if Google verification fails', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'invalid-token',
      };

      mockGoogleVerification.verify.mockResolvedValue({ success: false });

      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if Apple verification fails', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'apple' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'invalid-token',
      };

      mockAppleVerification.verify.mockResolvedValue({ success: false });

      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for unknown product ID', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.unknown.product',
        purchaseToken: 'valid-token',
      };

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
      });

      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update existing subscription for returning user', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.yearly',
        purchaseToken: 'new-token',
      };
      const now = new Date();

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        amount: 47.99,
        currency: 'USD',
        expirationTime: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      });

      mockPrisma.paymentTransaction.create.mockResolvedValue({
        id: 'tx-2',
        userId,
        amount: 47.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-789',
      });

      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'existing-sub',
        userId,
        plan: 'monthly',
        status: 'active',
      });

      mockPrisma.subscription.update.mockResolvedValue({
        id: 'existing-sub',
        userId,
        plan: 'yearly',
        status: 'active',
        startedAt: now,
        endsAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      });

      const result = await service.verifyPurchase(userId, dto);

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      expect(result.subscription?.plan).toBe('yearly');
    });
  });

  describe('getSubscription', () => {
    it('should return subscription for user', async () => {
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        startedAt: new Date(),
        endsAt: null,
        platform: null,
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.paymentTransaction.findFirst.mockResolvedValue(null);

      const result = await service.getSubscription('u1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('sub-1');
      expect(result!.plan).toBe('monthly');
      expect(result!.status).toBe('active');
      expect(result!.price).toBe(0);
      expect(result!.currency).toBe('USD');
      expect(result!.platform).toBeNull();
    });

    it('should return null if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      const result = await service.getSubscription('u1');

      expect(result).toBeNull();
    });
  });

  describe('cancelSubscription', () => {
    it('should throw NotFoundException if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancelSubscription('u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should cancel subscription and preserve endsAt', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: null,
        productId: null,
        purchaseToken: null,
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'cancelled', endsAt: futureDate },
      });
    });

    it('should call Google Play cancel API when platform is google', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'google',
        productId: 'com.storytime.monthly',
        purchaseToken: 'google-token-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });
      mockConfigService.get.mockReturnValue('com.storytime.app');
      mockGoogleVerification.cancelSubscription.mockResolvedValue(undefined);

      await service.cancelSubscription('u1');

      expect(mockGoogleVerification.cancelSubscription).toHaveBeenCalledWith({
        packageName: 'com.storytime.app',
        productId: 'com.storytime.monthly',
        purchaseToken: 'google-token-123',
      });
    });

    it('should still complete local cancellation even if Google cancel API fails', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'google',
        productId: 'com.storytime.monthly',
        purchaseToken: 'google-token-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });
      mockConfigService.get.mockReturnValue('com.storytime.app');
      mockGoogleVerification.cancelSubscription.mockRejectedValue(
        new Error('Google API unavailable'),
      );

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'cancelled', endsAt: futureDate },
      });
      expect(mockSubscriptionService.invalidateCache).toHaveBeenCalledWith(
        'u1',
      );
    });

    it('should check Apple subscription status when platform is apple', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'apple-tx-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: false,
      });

      const result = await service.cancelSubscription('u1');

      expect(mockAppleVerification.getSubscriptionStatus).toHaveBeenCalledWith(
        'apple-tx-123',
      );
      expect(result.status).toBe('cancelled');
      expect(result).not.toHaveProperty('platformWarning');
      expect(result).not.toHaveProperty('manageUrl');
    });

    it('should return warning and manageUrl when Apple auto-renewal is active', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'apple-tx-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: true,
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(result.platformWarning).toBe(
        'Apple subscription auto-renewal is still active. Please manage your subscription through your Apple ID settings.',
      );
      expect(result.manageUrl).toBe(
        'https://apps.apple.com/account/subscriptions',
      );
    });

    it('should skip platform API calls when platform is null', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: null,
        productId: null,
        purchaseToken: null,
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(mockGoogleVerification.cancelSubscription).not.toHaveBeenCalled();
      expect(
        mockAppleVerification.getSubscriptionStatus,
      ).not.toHaveBeenCalled();
    });

    it('should always complete local cancellation regardless of platform API errors', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'apple-tx-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });
      mockAppleVerification.getSubscriptionStatus.mockRejectedValue(
        new Error('Apple API unavailable'),
      );

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'cancelled', endsAt: futureDate },
      });
      expect(mockSubscriptionService.invalidateCache).toHaveBeenCalledWith(
        'u1',
      );
    });
  });
});
