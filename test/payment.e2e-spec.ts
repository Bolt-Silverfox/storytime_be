import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { Server } from 'http';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentController } from '../src/payment/payment.controller';
import { PaymentService } from '../src/payment/payment.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SuccessResponseInterceptor } from '../src/shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from '../src/shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter';
import { AuthThrottleGuard } from '../src/shared/guards/auth-throttle.guard';
import { AuthSessionGuard } from '../src/shared/guards/auth.guard';
import { GoogleVerificationService } from '../src/payment/google-verification.service';
import { AppleVerificationService } from '../src/payment/apple-verification.service';
import { SubscriptionService } from '../src/subscription/subscription.service';
import { CacheMetricsService } from '../src/shared/services/cache-metrics.service';

/**
 * E2E Tests for Payment Flows
 *
 * These tests cover:
 * - Purchase verification (Google Play and App Store)
 * - Subscription cancellation
 * - Subscription status retrieval
 * - Input validation for payment DTOs
 * - Duplicate receipt handling
 * - Edge cases (no subscription, invalid platform)
 */

// Shared mock state across all tests
const mockState = {
  subscriptions: new Map<string, Record<string, unknown>>(),
  paymentTransactions: new Map<string, Record<string, unknown>>(),
  users: new Map<string, Record<string, unknown>>(),
};

// Future date for subscription expiration
const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

// Mock user injected by the overridden AuthSessionGuard
const mockUserId = 'test-user-id';

describe('Payment (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          JWT_SECRET: 'test-jwt-secret-key-for-e2e-tests',
          JWT_EXPIRES_IN: '1h',
          GOOGLE_PLAY_PACKAGE_NAME: 'com.storytime.app',
          GOOGLE_SERVICE_ACCOUNT_KEY: '{}',
          APPLE_SHARED_SECRET: 'test-apple-secret',
        };
        return config[key] || undefined;
      }),
    };

    const mockPrismaService = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        CacheModule.register({ isGlobal: true }),
        ThrottlerModule.forRoot([
          { name: 'short', ttl: 1000, limit: 100 },
          { name: 'long', ttl: 60000, limit: 1000 },
        ]),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: () => ({
            secret: 'test-jwt-secret-key-for-e2e-tests',
            signOptions: { expiresIn: '1h' },
          }),
        }),
        EventEmitterModule.forRoot(),
      ],
      controllers: [PaymentController],
      providers: [
        PaymentService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: GoogleVerificationService,
          useValue: createMockGoogleVerificationService(),
        },
        {
          provide: AppleVerificationService,
          useValue: createMockAppleVerificationService(),
        },
        {
          provide: SubscriptionService,
          useValue: {
            invalidateCache: jest.fn().mockResolvedValue(undefined),
            getSubscriptionForUser: jest.fn().mockResolvedValue(null),
            isPremiumUser: jest.fn().mockResolvedValue(false),
            getPlans: jest.fn().mockReturnValue({}),
          },
        },
        {
          provide: CacheMetricsService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
            getOrSet: jest.fn((_key: string, fetcher: () => Promise<unknown>) =>
              fetcher(),
            ),
            getStats: jest
              .fn()
              .mockReturnValue({ hits: 0, misses: 0, hitRatio: 0 }),
            resetStats: jest.fn(),
            onModuleInit: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    })
      // Disable rate limiting in E2E tests
      .overrideGuard(AuthThrottleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // Override AuthSessionGuard to inject mock user for authenticated requests
      .overrideGuard(AuthSessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => Record<string, unknown>;
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          req.authUserData = {
            userId: mockUserId,
            email: 'test@example.com',
            role: 'parent',
          };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();

    // Apply global interceptors and filters
    app.useGlobalInterceptors(new SuccessResponseInterceptor());
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

    // Apply validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  // Reset mock state before each test
  beforeEach(() => {
    mockState.subscriptions.clear();
    mockState.paymentTransactions.clear();
    mockState.users.clear();
  });

  // ==================== HELPER FUNCTIONS ====================

  const expectSuccessResponse = (res: request.Response, statusCode: number) => {
    expect(res.status).toBe(statusCode);
    expect(res.body.success).toBe(true);
    expect(res.body.statusCode).toBe(statusCode);
    expect(res.body).toHaveProperty('data');
  };

  const expectErrorResponse = (
    res: request.Response,
    statusCode: number,
    errorType: string,
  ) => {
    expect(res.status).toBe(statusCode);
    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(statusCode);
    expect(res.body.error).toBe(errorType);
    expect(res.body).toHaveProperty('message');
  };

  // ==================== VERIFY PURCHASE TESTS ====================

  describe('POST /payment/verify-purchase', () => {
    it('should verify a valid Google Play purchase successfully', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
          purchaseToken: 'google-valid-token-123',
          packageName: 'com.storytime.app',
        });

      expectSuccessResponse(res, 201);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('transaction');
      expect(res.body.data).toHaveProperty('subscription');
      expect(res.body.data.alreadyProcessed).toBe(false);
      expect(res.body.data.transaction).toHaveProperty('userId', mockUserId);
      expect(res.body.data.transaction).toHaveProperty('status', 'success');
      expect(res.body.data.subscription).toHaveProperty('plan', 'monthly');
      expect(res.body.data.subscription).toHaveProperty('status', 'active');
    });

    it('should verify a valid Apple App Store purchase successfully', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'apple',
          productId: 'com.storytime.monthly',
          purchaseToken: 'apple-valid-token-456',
        });

      expectSuccessResponse(res, 201);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('transaction');
      expect(res.body.data).toHaveProperty('subscription');
      expect(res.body.data.alreadyProcessed).toBe(false);
      expect(res.body.data.transaction).toHaveProperty('userId', mockUserId);
      expect(res.body.data.subscription).toHaveProperty('plan', 'monthly');
      expect(res.body.data.subscription).toHaveProperty('status', 'active');
    });

    it('should reject an invalid platform value', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'stripe',
          productId: 'com.storytime.monthly',
          purchaseToken: 'some-token',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with missing required fields', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({});

      expectErrorResponse(res, 400, 'Bad Request');
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    it('should reject request with missing productId', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          purchaseToken: 'some-token',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with missing purchaseToken', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should handle duplicate receipt for the same user (idempotency)', async () => {
      // First purchase
      const firstRes = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
          purchaseToken: 'duplicate-token-789',
        });

      expectSuccessResponse(firstRes, 201);
      expect(firstRes.body.data.alreadyProcessed).toBe(false);

      // Second purchase with same token
      const secondRes = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
          purchaseToken: 'duplicate-token-789',
        });

      expectSuccessResponse(secondRes, 201);
      expect(secondRes.body.data.alreadyProcessed).toBe(true);
    });

    it('should reject unknown product ID', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.unknown_plan',
          purchaseToken: 'some-token',
        });

      // PaymentService throws BadRequestException for unknown product IDs
      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with extra non-whitelisted fields', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
          purchaseToken: 'some-token',
          extraField: 'should-not-be-allowed',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should accept packageName as optional field for Google purchases', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
          purchaseToken: 'google-with-package-token',
          packageName: 'com.storytime.custom',
        });

      expectSuccessResponse(res, 201);
      expect(res.body.data.success).toBe(true);
    });
  });

  // ==================== CANCEL SUBSCRIPTION TESTS ====================

  describe('POST /payment/cancel', () => {
    it('should cancel an active subscription', async () => {
      // First create a subscription by verifying a purchase
      await request(server).post('/api/v1/payment/verify-purchase').send({
        platform: 'google',
        productId: 'com.storytime.monthly',
        purchaseToken: 'cancel-test-token-001',
        packageName: 'com.storytime.app',
      });

      const res = await request(server).post('/api/v1/payment/cancel').send();

      expectSuccessResponse(res, 201);
      expect(res.body.data).toHaveProperty('status', 'cancelled');
    });

    it('should return 404 when cancelling with no subscription', async () => {
      const res = await request(server).post('/api/v1/payment/cancel').send();

      expectErrorResponse(res, 404, 'Not Found');
    });

    it('should include platform warning for Apple subscriptions', async () => {
      // Create an Apple subscription
      await request(server).post('/api/v1/payment/verify-purchase').send({
        platform: 'apple',
        productId: 'com.storytime.monthly',
        purchaseToken: 'apple-cancel-test-token',
      });

      const res = await request(server).post('/api/v1/payment/cancel').send();

      expectSuccessResponse(res, 201);
      expect(res.body.data).toHaveProperty('status', 'cancelled');
      // Apple subscriptions should include platformWarning about managing via Apple ID
      expect(res.body.data).toHaveProperty('platformWarning');
      expect(res.body.data.platformWarning).toContain('Apple');
      expect(res.body.data).toHaveProperty('manageUrl');
    });
  });

  // ==================== SUBSCRIPTION STATUS TESTS ====================

  describe('GET /payment/status', () => {
    it('should return subscription status for active subscription', async () => {
      // First create a subscription
      await request(server).post('/api/v1/payment/verify-purchase').send({
        platform: 'google',
        productId: 'com.storytime.monthly',
        purchaseToken: 'status-test-token-001',
      });

      const res = await request(server).get('/api/v1/payment/status').send();

      expectSuccessResponse(res, 200);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('plan', 'monthly');
      expect(res.body.data).toHaveProperty('status', 'active');
      expect(res.body.data).toHaveProperty('startedAt');
      expect(res.body.data).toHaveProperty('endsAt');
      expect(res.body.data).toHaveProperty('platform', 'google');
      expect(res.body.data).toHaveProperty('price');
      expect(res.body.data).toHaveProperty('currency', 'USD');
    });

    it('should return null when no subscription exists', async () => {
      const res = await request(server).get('/api/v1/payment/status').send();

      expectSuccessResponse(res, 200);
      expect(res.body.data).toBeNull();
    });
  });

  // ==================== VALIDATION EDGE CASES ====================

  describe('Validation Edge Cases', () => {
    it('should reject empty platform string', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: '',
          productId: 'com.storytime.monthly',
          purchaseToken: 'some-token',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject empty productId string', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: '',
          purchaseToken: 'some-token',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject empty purchaseToken string', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 'google',
          productId: 'com.storytime.monthly',
          purchaseToken: '',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject non-string platform value', async () => {
      const res = await request(server)
        .post('/api/v1/payment/verify-purchase')
        .send({
          platform: 123,
          productId: 'com.storytime.monthly',
          purchaseToken: 'some-token',
        });

      expectErrorResponse(res, 400, 'Bad Request');
    });
  });
});

// ==================== MOCK PRISMA SERVICE ====================

function createMockPrismaService() {
  const { subscriptions, paymentTransactions } = mockState;

  const prismaClient: any = {
    subscription: {
      findFirst: jest.fn(
        ({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId) {
            for (const sub of subscriptions.values()) {
              if (sub.userId === where.userId) return Promise.resolve(sub);
            }
          }
          if (where.id) {
            return Promise.resolve(subscriptions.get(where.id) || null);
          }
          return Promise.resolve(null);
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        return Promise.resolve(subscriptions.get(where.id) || null);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const sub = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        subscriptions.set(id, sub);
        return Promise.resolve(sub);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const sub = subscriptions.get(where.id);
          if (sub) {
            Object.assign(sub, data, { updatedAt: new Date() });
            return Promise.resolve(sub);
          }
          return Promise.resolve(null);
        },
      ),
    },
    paymentTransaction: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { reference?: string; userId?: string; status?: string };
          orderBy?: Record<string, string>;
        }) => {
          if (where.reference) {
            for (const tx of paymentTransactions.values()) {
              if (tx.reference === where.reference) {
                return Promise.resolve(tx);
              }
            }
          }
          if (where.userId) {
            // Return the latest transaction for the user (optionally filtered by status)
            for (const tx of paymentTransactions.values()) {
              if (
                tx.userId === where.userId &&
                (!where.status || tx.status === where.status)
              ) {
                return Promise.resolve(tx);
              }
            }
          }
          return Promise.resolve(null);
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tx = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        paymentTransactions.set(id, tx);
        return Promise.resolve(tx);
      }),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    // $transaction: support interactive transaction callbacks
    // The callback receives a "transactional prisma client" with the same methods
    $transaction: jest.fn(
      (operations: unknown[] | ((prisma: unknown) => Promise<unknown>)) => {
        if (typeof operations === 'function') {
          // Interactive transaction: execute the callback with a mock prisma client
          // that has the same model methods as the top-level mock
          return operations(prismaClient);
        }
        return Promise.all(operations as Promise<unknown>[]);
      },
    ),
  };

  return prismaClient;
}

// ==================== MOCK GOOGLE VERIFICATION SERVICE ====================

function createMockGoogleVerificationService() {
  return {
    verify: jest.fn().mockResolvedValue({
      success: true,
      platformTxId: 'google-tx-123',
      productId: 'com.storytime.monthly',
      amount: 4.99,
      currency: 'USD',
      purchaseTime: new Date(),
      expirationTime: futureDate,
      isSubscription: true,
      metadata: { acknowledgementState: 1 },
    }),
    acknowledgePurchase: jest.fn().mockResolvedValue({
      success: true,
    }),
    cancelSubscription: jest.fn().mockResolvedValue({
      success: true,
    }),
  };
}

// ==================== MOCK APPLE VERIFICATION SERVICE ====================

function createMockAppleVerificationService() {
  return {
    verify: jest.fn().mockResolvedValue({
      success: true,
      platformTxId: 'apple-tx-456',
      originalTxId: 'apple-original-tx-456',
      productId: 'com.storytime.monthly',
      amount: 4.99,
      currency: 'USD',
      purchaseTime: new Date(),
      expirationTime: futureDate,
      isSubscription: true,
      metadata: {},
    }),
    getSubscriptionStatus: jest.fn().mockResolvedValue({
      autoRenewActive: true,
      expirationTime: futureDate,
    }),
  };
}
