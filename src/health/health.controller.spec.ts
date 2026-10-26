import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
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
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

/**
 * Exercises the real terminus 12 HealthCheckService through HTTP, so the
 * response contract consumed by the container HEALTHCHECK and probes
 * (status code + `{ status, info, error, details }` body) is pinned.
 */
describe('HealthController (HTTP contract)', () => {
  let app: INestApplication;
  let redisDown = false;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const cbService = new CircuitBreakerService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: CircuitBreakerService, useValue: cbService },
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
          provide: RedisHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(
                redisDown
                  ? his.check(key).down({ error: 'ECONNREFUSED' })
                  : his.check(key).up({ response: 'PONG' }),
              ),
          }),
        },
        {
          provide: QueueHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(his.check(key).up({ totalFailed: 0 })),
          }),
        },
        { provide: SmtpHealthIndicator, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    redisDown = false;
  });

  it('GET /health returns 200 with status ok', async () => {
    const res = await request(server()).get('/health').expect(200);

    expect(res.body).toEqual({
      status: 'ok',
      info: {},
      error: {},
      details: {},
    });
  });

  it('GET /health/ready returns 200 with every indicator up', async () => {
    const res = await request(server()).get('/health/ready').expect(200);

    expect(res.body.status).toBe('ok');
    expect(Object.keys(res.body.info as object).sort()).toEqual([
      'circuit_breakers',
      'database',
      'email-queue',
      'redis',
      'tts-providers',
    ]);
    expect(res.body.error).toEqual({});
    expect(res.body.info.redis).toEqual({ status: 'up', response: 'PONG' });
  });

  it('GET /health/ready returns 503 and the down indicator under `error`', async () => {
    redisDown = true;

    const res = await request(server()).get('/health/ready').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.error).toEqual({
      redis: { status: 'down', error: 'ECONNREFUSED' },
    });
    expect(res.body.info.database).toEqual({
      status: 'up',
      connection: 'established',
    });
    expect(Object.keys(res.body.details as object)).toContain('redis');
  });

  it('GET /health/tts returns 503 when a TTS circuit breaker is OPEN', async () => {
    cbService.getBreaker('elevenlabs', { failureThreshold: 1 }).recordFailure({
      status: 500,
    });

    const res = await request(server()).get('/health/tts').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.error['tts-providers']).toMatchObject({
      status: 'down',
      elevenlabs: { state: 'OPEN' },
    });
  });
});
