import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthChecks } from './health-checks';
import {
  CircuitBreakerHealthIndicator,
  PrismaHealthIndicator,
  QueueHealthIndicator,
  RedisHealthIndicator,
  SmtpHealthIndicator,
  TTSCircuitBreakerHealthIndicator,
} from './indicators';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

const SECRETS = [
  'smtp.internal.example',
  '2525',
  'ECONNREFUSED',
  'prisma-secret-error',
  '12.5M',
  'used_memory',
  'elevenlabs',
  'failureCount',
  'heapUsed',
  'paused',
  'waiting',
];

describe('public health endpoints', () => {
  let app: INestApplication;
  let dbDown = false;
  const liveSmtp = jest.fn();
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const cbService = new CircuitBreakerService();

  beforeAll(async () => {
    cbService.getBreaker('elevenlabs', { failureThreshold: 1 }).recordFailure({
      status: 500,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        HealthChecks,
        { provide: CircuitBreakerService, useValue: cbService },
        CircuitBreakerHealthIndicator,
        TTSCircuitBreakerHealthIndicator,
        {
          provide: PrismaHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(
                dbDown
                  ? his.check(key).down({ error: 'prisma-secret-error' })
                  : his.check(key).up({ connection: 'established' }),
              ),
          }),
        },
        {
          provide: RedisHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(
                his.check(key).up({ response: 'PONG', usedMemory: '12.5M' }),
              ),
          }),
        },
        {
          provide: QueueHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(
                his.check(key).up({
                  queues: { email: { waiting: 4, paused: false } },
                }),
              ),
          }),
        },
        {
          provide: SmtpHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: liveSmtp,
            cachedHealth: (key: string) =>
              his.check(key).up({ host: 'smtp.internal.example', port: 2525 }),
          }),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dbDown = false;
    liveSmtp.mockReset();
  });

  it.each([
    '/health/ready',
    '/health/db',
    '/health/redis',
    '/health/smtp',
    '/health/queue',
    '/health/system',
    '/health/full',
    '/health/tts',
  ])('GET %s returns status only, with no detail text', async (path) => {
    const res = await request(server()).get(path);
    const raw = JSON.stringify(res.body);

    expect(res.body.status).toMatch(/^(ok|error)$/);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'checks',
      'status',
    ]);
    for (const [, check] of Object.entries(
      res.body.checks as Record<string, unknown>,
    )) {
      expect(Object.keys(check as object)).toEqual(['status']);
    }
    for (const secret of SECRETS) {
      expect(raw).not.toContain(secret);
    }
  });

  it('GET /health/full includes the smtp check', async () => {
    const res = await request(server()).get('/health/full');

    expect(res.body.checks.smtp).toEqual({ status: 'up' });
  });

  it('GET /health stays an empty liveness check', async () => {
    const res = await request(server()).get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', checks: {} });
  });

  it('keeps the 503 status code and hides the cause when a dependency is down', async () => {
    dbDown = true;

    const res = await request(server()).get('/health/ready').expect(503);

    expect(res.body).toEqual({
      status: 'error',
      checks: expect.objectContaining({ database: { status: 'down' } }),
    });
    expect(JSON.stringify(res.body)).not.toContain('prisma-secret-error');
  });

  it('never opens an SMTP connection on public calls', async () => {
    await request(server()).get('/health/smtp');
    await request(server()).get('/health/full');

    expect(liveSmtp).not.toHaveBeenCalled();
  });
});
