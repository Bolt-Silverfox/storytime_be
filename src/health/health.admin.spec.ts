import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import request from 'supertest';
import { AdminHealthController } from './health.admin.controller';
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
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

class HeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
    }>();
    if (req.headers['x-admin'] !== '1') throw new ForbiddenException();
    return true;
  }
}

describe('admin health endpoints', () => {
  let app: INestApplication;
  const liveSmtp = jest.fn();
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [AdminHealthController],
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
              Promise.resolve(his.check(key).up({ connection: 'established' })),
          }),
        },
        {
          provide: RedisHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => ({
            isHealthy: (key: string) =>
              Promise.resolve(his.check(key).down({ error: 'ECONNREFUSED' })),
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
        {
          provide: SmtpHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (his: HealthIndicatorService) => {
            liveSmtp.mockImplementation((key: string) =>
              Promise.resolve(his.check(key).up({ host: 'smtp.example' })),
            );
            return { isHealthy: liveSmtp, cachedHealth: jest.fn() };
          },
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useClass(HeaderGuard)
      .overrideGuard(AdminGuard)
      .useClass(HeaderGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is protected by AuthSessionGuard and AdminGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminHealthController,
    ) as unknown[];

    expect(guards).toEqual([AuthSessionGuard, AdminGuard]);
  });

  it('rejects callers who are not admins', async () => {
    await request(server()).get('/health/admin/ready').expect(403);
  });

  it('gives admins the full detail payload', async () => {
    const res = await request(server())
      .get('/health/admin/ready')
      .set('x-admin', '1')
      .expect(503);

    expect(res.body.error.redis).toEqual({
      status: 'down',
      error: 'ECONNREFUSED',
    });
    expect(res.body.info.database).toEqual({
      status: 'up',
      connection: 'established',
    });
  });

  it('runs the live SMTP check for admins', async () => {
    const res = await request(server())
      .get('/health/admin/smtp')
      .set('x-admin', '1')
      .expect(200);

    expect(liveSmtp).toHaveBeenCalledTimes(1);
    expect(res.body.info.smtp.host).toBe('smtp.example');
  });
});
