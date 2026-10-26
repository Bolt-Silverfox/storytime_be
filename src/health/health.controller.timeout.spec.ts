import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import { Queue } from 'bullmq';
import request from 'supertest';
import { HealthController } from './health.controller';
import {
  CircuitBreakerHealthIndicator,
  PrismaHealthIndicator,
  QueueHealthIndicator,
  RedisHealthIndicator,
  SmtpHealthIndicator,
  TTSCircuitBreakerHealthIndicator,
} from './indicators';
import {
  HEALTH_CHECK_TIMEOUT_MS,
  getHealthTimeoutMs,
  setHealthTimeoutMsForTesting,
} from './indicators/health-timeout';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

// A Redis that accepts nothing and answers nothing: every call stays pending.
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    connect: jest.fn(() => new Promise(() => undefined)),
    ping: jest.fn(() => new Promise(() => undefined)),
    info: jest.fn(() => new Promise(() => undefined)),
    disconnect: jest.fn(),
  })),
}));

const hungQueue = () => {
  const never = () => new Promise<never>(() => undefined);
  return {
    getWaitingCount: never,
    getActiveCount: never,
    getCompletedCount: never,
    getFailedCount: never,
    getDelayedCount: never,
    isPaused: never,
  } as unknown as Queue;
};

describe('health timeout default', () => {
  it('is 3000ms in production, well under the deploy curl --max-time', () => {
    expect(HEALTH_CHECK_TIMEOUT_MS).toBe(3000);
    expect(getHealthTimeoutMs()).toBe(3000);
  });
});

/**
 * Regression: with Redis down, BullMQ/ioredis calls queue offline and never
 * reject, so /health/ready, /health/queue and /health/full used to hang
 * forever. They must answer 503 well inside the deploy scripts' budget.
 */
describe('HealthController with an unresponsive Redis', () => {
  // Small deadline so the real HealthCheckService path runs in milliseconds
  // instead of waiting the production 3s (flaky under load vs jest's 5s).
  const TEST_TIMEOUT_MS = 100;
  let app: INestApplication;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    setHealthTimeoutMsForTesting(TEST_TIMEOUT_MS);
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        CircuitBreakerService,
        CircuitBreakerHealthIndicator,
        TTSCircuitBreakerHealthIndicator,
        {
          provide: PrismaHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(his.check(key).up({ connection: 'established' })),
          }),
        },
        {
          provide: SmtpHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) => Promise.resolve(his.check(key).up()),
          }),
        },
        {
          provide: RedisHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) =>
            new RedisHealthIndicator(his, {
              get: () => 'redis://localhost:6379',
            } as unknown as ConfigService<never, true>),
        },
        {
          provide: QueueHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) =>
            new QueueHealthIndicator(his, hungQueue(), hungQueue()),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    setHealthTimeoutMsForTesting(undefined);
    await app.close();
  });

  it.each([
    ['/health/ready', ['redis', 'email-queue']],
    ['/health/queue', ['email-queue']],
    ['/health/full', ['redis', 'email-queue']],
  ])(
    'GET %s returns 503 with down indicators within the timeout',
    async (path, down) => {
      const res = await request(server()).get(path).expect(503);

      expect(res.body.status).toBe('error');
      // memory_* may also be down on a busy host; only the Redis-backed ones matter.
      expect(Object.keys(res.body.error as object)).toEqual(
        expect.arrayContaining(down),
      );
      for (const key of down) {
        expect(res.body.error[key]).toMatchObject({
          status: 'down',
          error: `timeout after ${TEST_TIMEOUT_MS}ms`,
        });
      }
    },
  );
});
