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
import { HttpExceptionFilter } from '@/shared/filters/http-exception.filter';
import { SuccessResponseInterceptor } from '@/shared/interceptors/success-response.interceptor';

describe('health responses inside the app envelope', () => {
  let app: INestApplication;
  let dbDown = false;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const up =
      (details: Record<string, unknown> = {}) =>
      (his: HealthIndicatorService) => ({
        isHealthy: (key: string) => Promise.resolve(his.check(key).up(details)),
      });
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        HealthChecks,
        CircuitBreakerService,
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
          useFactory: up({ usedMemory: '12.5M' }),
        },
        {
          provide: QueueHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: up({ queues: { email: { waiting: 4 } } }),
        },
        {
          provide: SmtpHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: jest.fn(),
            cachedHealth: (key: string) => his.check(key).up(),
          }),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new SuccessResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dbDown = false;
  });

  it('wraps a healthy status in the success envelope', async () => {
    const res = await request(server()).get('/health/db').expect(200);

    expect(res.body).toEqual({
      statusCode: 200,
      success: true,
      data: { status: 'ok', checks: { database: { status: 'up' } } },
      message: expect.any(String),
    });
  });

  it('returns the error envelope with status and checks on 503, no cause', async () => {
    dbDown = true;

    const res = await request(server()).get('/health/ready').expect(503);

    expect(res.body).toMatchObject({
      statusCode: 503,
      success: false,
      status: 'error',
      checks: expect.objectContaining({ database: { status: 'down' } }),
    });
    expect(JSON.stringify(res.body)).not.toContain('prisma-secret-error');
  });
});
