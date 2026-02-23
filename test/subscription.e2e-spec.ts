import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { Server } from 'http';
import { PrismaService } from '../src/prisma/prisma.service';
import { SubscriptionController } from '../src/subscription/subscription.controller';
import { SubscriptionService } from '../src/subscription/subscription.service';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SuccessResponseInterceptor } from '../src/shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from '../src/shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter';
import { AuthThrottleGuard } from '../src/shared/guards/auth-throttle.guard';
import { AuthSessionGuard } from '../src/shared/guards/auth.guard';
import { CacheMetricsService } from '../src/shared/services/cache-metrics.service';

/**
 * E2E Tests for Subscription Flows
 *
 * These tests cover:
 * - Listing available subscription plans (public)
 * - Getting current user subscription (authenticated)
 * - Subscribing to a free plan (authenticated)
 * - Rejecting paid plan subscription (must use IAP)
 * - Cancelling a subscription (authenticated)
 * - Listing payment history (authenticated)
 * - Input validation
 * - Unauthenticated access rejection
 */

// Shared mock state across all tests
const mockState = {
  subscriptions: new Map<string, Record<string, unknown>>(),
  paymentTransactions: new Map<string, Record<string, unknown>[]>(),
};

const TEST_USER_ID = 'test-user-id';
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_ROLE = 'parent';

describe('Subscription (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const mockCacheMetricsService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      getOrSet: jest.fn(
        (_key: string, fetcher: () => Promise<unknown>) => fetcher(),
      ),
      getStats: jest
        .fn()
        .mockReturnValue({ hits: 0, misses: 0, hitRatio: 0 }),
      resetStats: jest.fn(),
      onModuleInit: jest.fn(),
    };

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
        EventEmitterModule.forRoot(),
      ],
      controllers: [SubscriptionController],
      providers: [
        SubscriptionService,
        {
          provide: PrismaService,
          useValue: createMockPrismaService(),
        },
        {
          provide: CacheMetricsService,
          useValue: mockCacheMetricsService,
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
          // If the request has an Authorization header, treat as authenticated
          const authHeader = (req.headers as Record<string, string>)
            ?.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            req.authUserData = {
              userId: TEST_USER_ID,
              email: TEST_USER_EMAIL,
              role: TEST_USER_ROLE,
            };
            return true;
          }
          // No auth header -> throw 401
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { UnauthorizedException } = require('@nestjs/common');
          throw new UnauthorizedException(
            'Missing or invalid authorization header',
          );
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
    if (app) await app.close();
  });

  beforeEach(() => {
    // Reset mock state between tests
    mockState.subscriptions.clear();
    mockState.paymentTransactions.clear();
  });

  // ==================== HELPER FUNCTIONS ====================

  const expectSuccessResponse = (
    res: request.Response,
    statusCode: number,
  ) => {
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

  const authenticatedGet = (url: string) =>
    request(server)
      .get(url)
      .set('Authorization', 'Bearer mock-valid-token');

  const authenticatedPost = (url: string) =>
    request(server)
      .post(url)
      .set('Authorization', 'Bearer mock-valid-token');

  // ==================== GET PLANS TESTS ====================

  describe('GET /subscription/plans', () => {
    it('should return all available plans without authentication', async () => {
      const res = await request(server).get('/api/v1/subscription/plans');

      expectSuccessResponse(res, 200);
      expect(res.body.data).toHaveProperty('free');
      expect(res.body.data).toHaveProperty('weekly');
      expect(res.body.data).toHaveProperty('monthly');
      expect(res.body.data).toHaveProperty('yearly');
    });

    it('should return plans with correct structure', async () => {
      const res = await request(server).get('/api/v1/subscription/plans');

      expectSuccessResponse(res, 200);

      const plans = res.body.data;

      // Verify free plan
      expect(plans.free).toEqual(
        expect.objectContaining({
          display: 'Free',
          amount: 0,
        }),
      );
      expect(plans.free).toHaveProperty('days');

      // Verify weekly plan
      expect(plans.weekly).toEqual(
        expect.objectContaining({
          display: 'Weekly',
          amount: 1.5,
          days: 7,
        }),
      );

      // Verify monthly plan
      expect(plans.monthly).toEqual(
        expect.objectContaining({
          display: 'Monthly',
          amount: 4.99,
          days: 30,
        }),
      );

      // Verify yearly plan
      expect(plans.yearly).toEqual(
        expect.objectContaining({
          display: 'Yearly',
          amount: 47.99,
          days: 365,
        }),
      );
    });

    it('should return plans with authentication as well', async () => {
      const res = await authenticatedGet('/api/v1/subscription/plans');

      expectSuccessResponse(res, 200);
      expect(res.body.data).toHaveProperty('free');
    });
  });

  // ==================== GET MY SUBSCRIPTION TESTS ====================

  describe('GET /subscription/me', () => {
    it('should return null when user has no subscription', async () => {
      const res = await authenticatedGet('/api/v1/subscription/me');

      expectSuccessResponse(res, 200);
      expect(res.body.data).toBeNull();
    });

    it('should return subscription when user has one', async () => {
      // Seed a subscription for the test user
      const now = new Date();
      const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      mockState.subscriptions.set(TEST_USER_ID, {
        id: 'sub-1',
        userId: TEST_USER_ID,
        plan: 'free',
        status: 'active',
        startedAt: now,
        endsAt,
        createdAt: now,
        updatedAt: now,
      });

      const res = await authenticatedGet('/api/v1/subscription/me');

      expectSuccessResponse(res, 200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.userId).toBe(TEST_USER_ID);
      expect(res.body.data.plan).toBe('free');
      expect(res.body.data.status).toBe('active');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).get('/api/v1/subscription/me');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== SUBSCRIBE TESTS ====================

  describe('POST /subscription/subscribe', () => {
    it('should subscribe to free plan successfully', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'free' });

      expectSuccessResponse(res, 201);
      expect(res.body.data).toHaveProperty('subscription');
      expect(res.body.data.subscription.plan).toBe('free');
      expect(res.body.data.subscription.status).toBe('active');
      expect(res.body.data.subscription.userId).toBe(TEST_USER_ID);
    });

    it('should update existing subscription when subscribing to free plan again', async () => {
      // Seed an existing subscription
      const now = new Date();
      mockState.subscriptions.set(TEST_USER_ID, {
        id: 'sub-existing',
        userId: TEST_USER_ID,
        plan: 'free',
        status: 'cancelled',
        startedAt: now,
        endsAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'free' });

      expectSuccessResponse(res, 201);
      expect(res.body.data.subscription.status).toBe('active');
    });

    it('should reject paid plan subscription (weekly)', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'weekly' });

      expectErrorResponse(res, 400, 'Bad Request');
      expect(res.body.message).toContain('Paid plans require In-App Purchase');
    });

    it('should reject paid plan subscription (monthly)', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'monthly' });

      expectErrorResponse(res, 400, 'Bad Request');
      expect(res.body.message).toContain('Paid plans require In-App Purchase');
    });

    it('should reject paid plan subscription (yearly)', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'yearly' });

      expectErrorResponse(res, 400, 'Bad Request');
      expect(res.body.message).toContain('Paid plans require In-App Purchase');
    });

    it('should reject invalid plan name', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'nonexistent-plan' });

      expectErrorResponse(res, 400, 'Bad Request');
      expect(res.body.message).toContain('Invalid plan');
    });

    it('should reject request with missing plan field', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({});

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with non-string plan field', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 123 });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .post('/api/v1/subscription/subscribe')
        .send({ plan: 'free' });

      expectErrorResponse(res, 401, 'Unauthorized');
    });

    it('should reject request with unexpected fields', async () => {
      const res = await authenticatedPost(
        '/api/v1/subscription/subscribe',
      ).send({ plan: 'free', unknownField: 'value' });

      expectErrorResponse(res, 400, 'Bad Request');
    });
  });

  // ==================== CANCEL SUBSCRIPTION TESTS ====================

  describe('POST /subscription/cancel', () => {
    it('should cancel an active subscription', async () => {
      // Seed an active subscription with future endsAt
      const now = new Date();
      const futureEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      mockState.subscriptions.set(TEST_USER_ID, {
        id: 'sub-cancel-1',
        userId: TEST_USER_ID,
        plan: 'free',
        status: 'active',
        startedAt: now,
        endsAt: futureEnd,
        createdAt: now,
        updatedAt: now,
      });

      const res = await authenticatedPost('/api/v1/subscription/cancel');

      expectSuccessResponse(res, 201);
      expect(res.body.data.status).toBe('cancelled');
      // Should keep the future endsAt
      expect(res.body.data.endsAt).toBeDefined();
    });

    it('should cancel subscription with past endsAt and set endsAt to now', async () => {
      // Seed a subscription with expired endsAt
      const now = new Date();
      const pastEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      mockState.subscriptions.set(TEST_USER_ID, {
        id: 'sub-cancel-2',
        userId: TEST_USER_ID,
        plan: 'monthly',
        status: 'active',
        startedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
        endsAt: pastEnd,
        createdAt: now,
        updatedAt: now,
      });

      const res = await authenticatedPost('/api/v1/subscription/cancel');

      expectSuccessResponse(res, 201);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('should return 404 when no subscription exists', async () => {
      const res = await authenticatedPost('/api/v1/subscription/cancel');

      expectErrorResponse(res, 404, 'Not Found');
      expect(res.body.message).toContain('No active subscription');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).post('/api/v1/subscription/cancel');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== PAYMENT HISTORY TESTS ====================

  describe('GET /subscription/history', () => {
    it('should return empty array when no transactions exist', async () => {
      const res = await authenticatedGet('/api/v1/subscription/history');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('should return payment transactions for user', async () => {
      // Seed payment transactions
      const now = new Date();
      mockState.paymentTransactions.set(TEST_USER_ID, [
        {
          id: 'tx-1',
          userId: TEST_USER_ID,
          amount: 4.99,
          currency: 'USD',
          plan: 'monthly',
          status: 'completed',
          provider: 'apple',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'tx-2',
          userId: TEST_USER_ID,
          amount: 1.5,
          currency: 'USD',
          plan: 'weekly',
          status: 'completed',
          provider: 'google',
          createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        },
      ]);

      const res = await authenticatedGet('/api/v1/subscription/history');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('amount');
      expect(res.body.data[0]).toHaveProperty('userId', TEST_USER_ID);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).get('/api/v1/subscription/history');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });
});

// ==================== MOCK PRISMA SERVICE ====================

function createMockPrismaService() {
  const { subscriptions, paymentTransactions } = mockState;

  // Helper to create a mock transactional prisma client that delegates to the same maps
  const createTxClient = () => ({
    subscription: {
      findFirst: jest.fn(({ where }: { where: { userId?: string } }) => {
        if (where.userId) {
          return Promise.resolve(subscriptions.get(where.userId) || null);
        }
        return Promise.resolve(null);
      }),
      findUnique: jest.fn(({ where }: { where: { id?: string } }) => {
        if (where.id) {
          for (const sub of subscriptions.values()) {
            if (sub.id === where.id) return Promise.resolve(sub);
          }
        }
        return Promise.resolve(null);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const subscription = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        subscriptions.set(data.userId as string, subscription);
        return Promise.resolve(subscription);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const [key, sub] of subscriptions.entries()) {
            if (sub.id === where.id) {
              const updated = { ...sub, ...data, updatedAt: new Date() };
              subscriptions.set(key, updated);
              return Promise.resolve(updated);
            }
          }
          return Promise.resolve(null);
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { id?: string; userId?: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existingKey = where.userId || where.id;
          if (existingKey && subscriptions.has(existingKey)) {
            const existing = subscriptions.get(existingKey)!;
            const updated = { ...existing, ...update, updatedAt: new Date() };
            subscriptions.set(existingKey, updated);
            return Promise.resolve(updated);
          }
          const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const subscription = {
            id,
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const key = (create.userId as string) || id;
          subscriptions.set(key, subscription);
          return Promise.resolve(subscription);
        },
      ),
    },
  });

  return {
    subscription: {
      findUnique: jest.fn(({ where }: { where: { id?: string } }) => {
        if (where.id) {
          for (const sub of subscriptions.values()) {
            if (sub.id === where.id) return Promise.resolve(sub);
          }
        }
        return Promise.resolve(null);
      }),
      findFirst: jest.fn(
        ({ where }: { where: { userId?: string; status?: string } }) => {
          if (where.userId) {
            return Promise.resolve(subscriptions.get(where.userId) || null);
          }
          return Promise.resolve(null);
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const subscription = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        subscriptions.set(data.userId as string, subscription);
        return Promise.resolve(subscription);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const [key, sub] of subscriptions.entries()) {
            if (sub.id === where.id) {
              const updated = { ...sub, ...data, updatedAt: new Date() };
              subscriptions.set(key, updated);
              return Promise.resolve(updated);
            }
          }
          return Promise.resolve(null);
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { id?: string; userId?: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existingKey = where.userId || where.id;
          if (existingKey && subscriptions.has(existingKey)) {
            const existing = subscriptions.get(existingKey)!;
            const updated = { ...existing, ...update, updatedAt: new Date() };
            subscriptions.set(existingKey, updated);
            return Promise.resolve(updated);
          }
          const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const subscription = {
            id,
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const key = (create.userId as string) || id;
          subscriptions.set(key, subscription);
          return Promise.resolve(subscription);
        },
      ),
    },
    paymentTransaction: {
      findMany: jest.fn(({ where }: { where: { userId?: string } }) => {
        if (where.userId) {
          return Promise.resolve(paymentTransactions.get(where.userId) || []);
        }
        return Promise.resolve([]);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const transaction = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const userId = data.userId as string;
        const existing = paymentTransactions.get(userId) || [];
        existing.push(transaction);
        paymentTransactions.set(userId, existing);
        return Promise.resolve(transaction);
      }),
    },
    $transaction: jest.fn(
      (operations: unknown[] | ((prisma: unknown) => Promise<unknown>)) => {
        if (typeof operations === 'function') {
          // Interactive transaction - pass a mock tx client that delegates to the same maps
          const txClient = createTxClient();
          return operations(txClient);
        }
        return Promise.all(operations as Promise<unknown>[]);
      },
    ),
  };
}
