import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';

// Type-safe mock for PrismaService
type MockPrismaService = {
  paymentTransaction: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  subscription: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};

const createMockPrismaService = (): MockPrismaService => ({
  paymentTransaction: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  subscription: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
});

describe('PaymentService', () => {
  let service: PaymentService;
  let mockPrisma: MockPrismaService;
  let mockGoogleVerification: {
    verify: jest.Mock;
    cancelSubscription: jest.Mock;
  };
  let mockAppleVerification: {
    verify: jest.Mock;
    getSubscriptionStatus: jest.Mock;
  };
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockGoogleVerification = {
      verify: jest.fn(),
      cancelSubscription: jest.fn(),
    };
    mockAppleVerification = {
      verify: jest.fn(),
      getSubscriptionStatus: jest.fn(),
    };
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          GOOGLE_PLAY_PACKAGE_NAME: 'com.storytime.app',
        };
        return config[key];
      }),
    };

    jest.clearAllMocks();

    mockPrisma.paymentTransaction.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: GoogleVerificationService,
          useValue: mockGoogleVerification,
        },
        { provide: AppleVerificationService, useValue: mockAppleVerification },
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
      const mockSub = { id: 'sub-1', plan: 'monthly', status: 'active' };
      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);

      const result = await service.getSubscription('u1');

      expect(result).toEqual(mockSub);
      expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
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

    it('should cancel subscription and preserve endsAt (no platform)', async () => {
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
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'cancelled', endsAt: futureDate },
      });
    });

    it('should call Google Play cancel API for google subscriptions', async () => {
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
      mockGoogleVerification.cancelSubscription.mockResolvedValue({
        success: true,
      });
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(mockGoogleVerification.cancelSubscription).toHaveBeenCalledWith({
        packageName: 'com.storytime.app',
        productId: 'com.storytime.monthly',
        purchaseToken: 'google-token-123',
      });
    });

    it('should still cancel locally if Google Play cancel fails', async () => {
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
      mockGoogleVerification.cancelSubscription.mockResolvedValue({
        success: false,
        error: 'API error',
      });
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
    });

    it('should return warning when Apple auto-renewal is still active', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'original-tx-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: true,
      });
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(mockAppleVerification.getSubscriptionStatus).toHaveBeenCalledWith(
        'original-tx-123',
      );
      expect(result).toHaveProperty('warning');
      expect(result).toHaveProperty(
        'manageUrl',
        'https://apps.apple.com/account/subscriptions',
      );
    });

    it('should not return warning when Apple auto-renewal is already off', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'original-tx-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: false,
      });
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(result).not.toHaveProperty('warning');
    });

    it('should still cancel locally if Apple status check fails', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: futureDate,
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'original-tx-123',
      };

      mockPrisma.subscription.findFirst.mockResolvedValue(mockSub);
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: false,
        error: 'Apple credentials not configured',
      });
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
    });
  });
});
