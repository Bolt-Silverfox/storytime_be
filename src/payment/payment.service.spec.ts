import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationService } from '../notification/notification.service';
import { Prisma } from '@prisma/client';
import {
  SUBSCRIPTION_REPOSITORY,
  ISubscriptionRepository,
  PAYMENT_TRANSACTION_REPOSITORY,
  IPaymentTransactionRepository,
} from './repositories';

// Type-safe mocks for repositories
type MockSubscriptionRepository = Record<
  keyof ISubscriptionRepository,
  jest.Mock
>;
type MockPaymentTransactionRepository = Record<
  keyof IPaymentTransactionRepository,
  jest.Mock
>;

const createMockSubscriptionRepository = (): MockSubscriptionRepository => ({
  findFirstByUser: jest.fn(),
  findById: jest.fn(),
  updateById: jest.fn(),
  // CAS write defaults to a matched row (applied). Conflict/lost-race tests
  // override this to resolve 0.
  updateByIdIfToken: jest.fn().mockResolvedValue(1),
  create: jest.fn(),
});

const createMockPaymentTransactionRepository =
  (): MockPaymentTransactionRepository => ({
    findLatestSuccessfulByUser: jest.fn(),
    findFirstByReference: jest.fn(),
    create: jest.fn(),
  });

describe('PaymentService', () => {
  let service: PaymentService;
  let mockSubscriptionRepo: MockSubscriptionRepository;
  let mockPaymentTxRepo: MockPaymentTransactionRepository;
  let mockGoogleVerification: {
    verify: jest.Mock;
    acknowledgePurchase: jest.Mock;
    cancelSubscription: jest.Mock;
  };
  let mockAppleVerification: {
    verify: jest.Mock;
    getSubscriptionStatus: jest.Mock;
  };
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockSubscriptionRepo = createMockSubscriptionRepository();
    mockPaymentTxRepo = createMockPaymentTransactionRepository();
    mockGoogleVerification = {
      verify: jest.fn(),
      acknowledgePurchase: jest.fn().mockResolvedValue({ success: true }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: SUBSCRIPTION_REPOSITORY, useValue: mockSubscriptionRepo },
        {
          provide: PAYMENT_TRANSACTION_REPOSITORY,
          useValue: mockPaymentTxRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: GoogleVerificationService,
          useValue: mockGoogleVerification,
        },
        { provide: AppleVerificationService, useValue: mockAppleVerification },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: NotificationService,
          useValue: {
            sendNotification: jest.fn().mockResolvedValue({ success: true }),
          },
        },
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
        metadata: { acknowledgementState: 1 },
      });

      mockPaymentTxRepo.create.mockResolvedValue({
        id: 'tx-1',
        userId,
        paymentMethodId: null,
        amount: 4.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-123',
      });
      // findFirst called in upsertSubscriptionWithExpiry: no existing sub
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(null);
      mockSubscriptionRepo.create.mockResolvedValue({
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
      expect(mockPaymentTxRepo.create).toHaveBeenCalled();
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

      mockPaymentTxRepo.create.mockResolvedValue({
        id: 'tx-1',
        userId,
        paymentMethodId: null,
        amount: 4.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-456',
      });
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(null);
      mockSubscriptionRepo.create.mockResolvedValue({
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

    it('should handle duplicate Google receipt (idempotency) via P2002', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'duplicate-token',
      };

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        metadata: { acknowledgementState: 1 },
      });

      // Simulate P2002 unique constraint violation on paymentTransaction.create
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPaymentTxRepo.create.mockRejectedValue(p2002Error);

      // findFirstByReference returns existing transaction for the same user
      mockPaymentTxRepo.findFirstByReference.mockResolvedValue({
        id: 'tx-existing',
        userId: 'user-1',
        amount: 4.99,
        currency: 'USD',
        status: 'success',
        reference: 'existing-hash',
      });

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue({
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        startedAt: new Date(),
        endsAt: new Date(),
      });

      const result = await service.verifyPurchase(userId, dto);

      expect(result.success).toBe(true);
      expect((result as { alreadyProcessed?: boolean }).alreadyProcessed).toBe(
        true,
      );
    });

    it('should reject receipt reuse from different user via P2002', async () => {
      const userId = 'user-2';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'reused-token',
      };

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        metadata: { acknowledgementState: 1 },
      });

      // Simulate P2002 unique constraint violation
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPaymentTxRepo.create.mockRejectedValue(p2002Error);

      // Existing transaction belongs to a different user
      mockPaymentTxRepo.findFirstByReference.mockResolvedValue({
        id: 'tx-existing',
        userId: 'user-1',
        amount: 4.99,
        currency: 'USD',
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
        metadata: { acknowledgementState: 1 },
      });

      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does NOT clobber a concurrently-installed DIFFERENT token (CAS conflict)', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'new-google-token',
      };
      const now = new Date();

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        platformTxId: 'GPA.5678',
        amount: 4.99,
        currency: 'USD',
        expirationTime: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        linkedPurchaseToken: 'old-google-token',
        metadata: { acknowledgementState: 1 },
      });

      // The migration reads the row (still the linked/old token). The CAS
      // affects zero rows because a concurrent delivery already swapped the row
      // to a DIFFERENT token; the re-read reveals that winning token.
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue({
        id: 'sub-1',
        userId,
        plan: 'monthly',
        status: 'active',
        purchaseToken: 'old-google-token',
      });
      mockSubscriptionRepo.updateByIdIfToken.mockResolvedValue(0);
      mockSubscriptionRepo.findById.mockResolvedValue({
        id: 'sub-1',
        userId,
        plan: 'monthly',
        status: 'active',
        purchaseToken: 'concurrent-winner-token',
      });

      // The delivery must abort so the concurrent winner is preserved.
      await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(
        ConflictException,
      );

      // Only the migration CAS was attempted (0). The flow never reached the
      // subscription upsert, so the winning token is never overwritten.
      expect(mockSubscriptionRepo.updateByIdIfToken).toHaveBeenCalledTimes(1);
      expect(mockSubscriptionRepo.updateByIdIfToken).toHaveBeenCalledWith(
        'sub-1',
        'old-google-token',
        { purchaseToken: 'new-google-token' },
      );
      expect(mockSubscriptionRepo.create).not.toHaveBeenCalled();
    });

    it('treats a zero-row CAS as success when the row already holds OUR token (idempotent repeat)', async () => {
      const userId = 'user-1';
      const dto = {
        platform: 'google' as const,
        productId: 'com.storytime.monthly',
        purchaseToken: 'new-google-token',
      };
      const now = new Date();

      mockGoogleVerification.verify.mockResolvedValue({
        success: true,
        isSubscription: true,
        platformTxId: 'GPA.5678',
        amount: 4.99,
        currency: 'USD',
        expirationTime: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        linkedPurchaseToken: 'old-google-token',
        metadata: { acknowledgementState: 1 },
      });

      // Migration read sees the old token; the CAS misses because an identical
      // concurrent delivery already migrated the row to OUR new token. The
      // re-read confirms it holds newToken, so this is an idempotent repeat and
      // the flow proceeds to a successful result.
      mockSubscriptionRepo.findFirstByUser
        .mockResolvedValueOnce({
          id: 'sub-1',
          userId,
          plan: 'monthly',
          status: 'active',
          purchaseToken: 'old-google-token',
        })
        .mockResolvedValue({
          id: 'sub-1',
          userId,
          plan: 'monthly',
          status: 'active',
          startedAt: now,
          endsAt: now,
          purchaseToken: 'new-google-token',
        });
      // Migration CAS misses (0); the subsequent upsert guard matches (1).
      mockSubscriptionRepo.updateByIdIfToken
        .mockResolvedValueOnce(0)
        .mockResolvedValue(1);
      mockSubscriptionRepo.findById.mockResolvedValue({
        id: 'sub-1',
        userId,
        plan: 'monthly',
        status: 'active',
        startedAt: now,
        endsAt: now,
        purchaseToken: 'new-google-token',
      });
      mockPaymentTxRepo.create.mockResolvedValue({
        id: 'tx-idem',
        userId,
        amount: 4.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-idem',
      });

      const result = await service.verifyPurchase(userId, dto);

      expect(result.success).toBe(true);
      expect(mockSubscriptionRepo.create).not.toHaveBeenCalled();
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
        metadata: { acknowledgementState: 1 },
      });

      mockPaymentTxRepo.create.mockResolvedValue({
        id: 'tx-2',
        userId,
        amount: 47.99,
        currency: 'USD',
        status: 'success',
        reference: 'hash-789',
      });

      // Initial read sees the old row; the guarded re-read after the write
      // returns the upgraded row.
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue({
        id: 'existing-sub',
        userId,
        plan: 'monthly',
        status: 'active',
        purchaseToken: null,
      });
      mockSubscriptionRepo.findById.mockResolvedValue({
        id: 'existing-sub',
        userId,
        plan: 'yearly',
        status: 'active',
        startedAt: now,
        endsAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        purchaseToken: 'new-token',
      });

      const result = await service.verifyPurchase(userId, dto);

      // Existing-row writes go through the token-guarded CAS (updateByIdIfToken),
      // not an unconditional update-by-id, so a concurrent token cannot be
      // clobbered.
      expect(mockSubscriptionRepo.updateByIdIfToken).toHaveBeenCalledWith(
        'existing-sub',
        null,
        expect.objectContaining({
          plan: 'yearly',
          purchaseToken: 'new-token',
        }),
      );
      expect(mockSubscriptionRepo.updateById).not.toHaveBeenCalled();
      expect(mockSubscriptionRepo.create).not.toHaveBeenCalled();
      expect(result.subscription?.plan).toBe('yearly');
    });
  });

  describe('getSubscription', () => {
    it('should return enriched subscription for user', async () => {
      const mockSub = {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        startedAt: new Date(),
        endsAt: new Date(),
        platform: null,
      };
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockPaymentTxRepo.findLatestSuccessfulByUser.mockResolvedValue({
        amount: 4.99,
        currency: 'USD',
      });

      const result = await service.getSubscription('u1');

      expect(result).toEqual({
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        startedAt: mockSub.startedAt,
        endsAt: mockSub.endsAt,
        platform: null,
        price: 4.99,
        currency: 'USD',
      });
      expect(mockSubscriptionRepo.findFirstByUser).toHaveBeenCalledWith('u1');
      expect(mockPaymentTxRepo.findLatestSuccessfulByUser).toHaveBeenCalledWith(
        'u1',
      );
    });

    it('should return null if no subscription exists', async () => {
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(null);

      const result = await service.getSubscription('u1');

      expect(result).toBeNull();
    });
  });

  describe('cancelSubscription', () => {
    it('should throw NotFoundException if no subscription exists', async () => {
      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(null);

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

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockSubscriptionRepo.updateById.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
      expect(mockGoogleVerification.cancelSubscription).not.toHaveBeenCalled();
      expect(
        mockAppleVerification.getSubscriptionStatus,
      ).not.toHaveBeenCalled();
      expect(mockSubscriptionRepo.updateById).toHaveBeenCalledWith('sub-1', {
        status: 'cancelled',
        endsAt: futureDate,
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

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockGoogleVerification.cancelSubscription.mockResolvedValue({
        success: true,
      });
      mockSubscriptionRepo.updateById.mockResolvedValue({
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

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockGoogleVerification.cancelSubscription.mockResolvedValue({
        success: false,
        error: 'API error',
      });
      mockSubscriptionRepo.updateById.mockResolvedValue({
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

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: true,
      });
      mockSubscriptionRepo.updateById.mockResolvedValue({
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

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: false,
      });
      mockSubscriptionRepo.updateById.mockResolvedValue({
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

      mockSubscriptionRepo.findFirstByUser.mockResolvedValue(mockSub);
      mockAppleVerification.getSubscriptionStatus.mockResolvedValue({
        autoRenewActive: false,
        error: 'Apple credentials not configured',
      });
      mockSubscriptionRepo.updateById.mockResolvedValue({
        ...mockSub,
        status: 'cancelled',
      });

      const result = await service.cancelSubscription('u1');

      expect(result.status).toBe('cancelled');
    });
  });
});
