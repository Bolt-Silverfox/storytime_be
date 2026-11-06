import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { PasswordlessController } from './passwordless.controller';
import { PasswordlessService } from './services/passwordless.service';
import { PasswordlessEnabledGuard } from './guards/passwordless-enabled.guard';
import { AuthThrottleGuard } from '@/shared/guards/auth-throttle.guard';
import { HttpExceptionFilter } from '@/shared/filters/http-exception.filter';

const GENERIC = 'Invalid or expired code';

async function makeApp(enabled: boolean) {
  const service = {
    request: jest.fn().mockResolvedValue({
      message: 'ok',
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    }),
    verify: jest.fn().mockResolvedValue({ jwt: 'j', isNewUser: false }),
    consume: jest.fn().mockResolvedValue({ jwt: 'j', isNewUser: false }),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [PasswordlessController],
    providers: [
      { provide: PasswordlessService, useValue: service },
      PasswordlessEnabledGuard,
      {
        provide: ConfigService,
        useValue: {
          get: (k: string) =>
            k === 'PASSWORDLESS_LOGIN_ENABLED' ? enabled : undefined,
        },
      },
    ],
  })
    .overrideGuard(AuthThrottleGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return { app, service };
}

describe('PasswordlessController', () => {
  describe('feature flag off', () => {
    let app: INestApplication;
    let service: Awaited<ReturnType<typeof makeApp>>['service'];
    beforeAll(async () => ({ app, service } = await makeApp(false)));
    afterAll(() => app.close());

    it.each([
      ['/auth/passwordless/request', { email: 'a@example.com' }],
      ['/auth/passwordless/verify', { email: 'a@example.com', code: '123456' }],
      ['/auth/passwordless/consume', { token: 'A'.repeat(43) }],
    ])('%s returns 404 and does nothing', async (path, body) => {
      await request(app.getHttpServer()).post(path).send(body).expect(404);
      expect(service.request).not.toHaveBeenCalled();
      expect(service.verify).not.toHaveBeenCalled();
      expect(service.consume).not.toHaveBeenCalled();
    });
  });

  describe('feature flag on', () => {
    let app: INestApplication;
    let service: Awaited<ReturnType<typeof makeApp>>['service'];
    beforeAll(async () => ({ app, service } = await makeApp(true)));
    afterAll(() => app.close());
    beforeEach(() => jest.clearAllMocks());

    it('request trims and lowercases the email and passes the IP', async () => {
      await request(app.getHttpServer())
        .post('/auth/passwordless/request')
        .send({ email: '  A@Example.COM ' })
        .expect(200);
      expect(service.request).toHaveBeenCalledWith(
        'a@example.com',
        expect.anything(),
      );
    });

    it('request rejects a bad or oversize email with 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/passwordless/request')
        .send({ email: 'nope' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/auth/passwordless/request')
        .send({ email: `${'a'.repeat(250)}@example.com` })
        .expect(400);
      expect(service.request).not.toHaveBeenCalled();
    });

    it('verify passes the normalised email, code and guest header', async () => {
      const guest = '0b1f6b4e-7c1a-4a39-9a55-2f1f6f0f7a11';
      await request(app.getHttpServer())
        .post('/auth/passwordless/verify')
        .set('x-guest-session-id', guest)
        .send({ email: ' A@Example.com', code: '123456' })
        .expect(200);
      expect(service.verify).toHaveBeenCalledWith(
        'a@example.com',
        '123456',
        expect.anything(),
        guest,
      );
    });

    it.each([
      ['verify', { email: 'a@example.com', code: '12345' }],
      ['verify', { email: 'a@example.com', code: '12345a' }],
      ['verify', { email: 'a@example.com', code: 123456 }],
      ['verify', { email: 'a@example.com' }],
      ['verify', { email: 'not-an-email', code: '123456' }],
      ['verify', { email: 'a@example.com', code: '123456', extra: 1 }],
      ['consume', { token: 'short' }],
      ['consume', { token: `${'A'.repeat(42)}!` }],
      ['consume', { token: 'A'.repeat(44) }],
      ['consume', {}],
      ['consume', { token: 'A'.repeat(43), extra: true }],
    ])(
      '%s with malformed body %j gets the identical generic 400',
      async (route, body) => {
        const res = await request(app.getHttpServer())
          .post(`/auth/passwordless/${route}`)
          .send(body)
          .expect(400);
        expect(res.body).toMatchObject({ message: GENERIC });
        expect(service.verify).not.toHaveBeenCalled();
        expect(service.consume).not.toHaveBeenCalled();
      },
    );

    it('malformed bodies are byte-identical to service-level failures', async () => {
      const malformed = await request(app.getHttpServer())
        .post('/auth/passwordless/verify')
        .send({ email: 'a@example.com', code: 'abc' });
      const { BadRequestException } = await import('@nestjs/common');
      service.verify.mockRejectedValueOnce(new BadRequestException(GENERIC));
      const wrong = await request(app.getHttpServer())
        .post('/auth/passwordless/verify')
        .send({ email: 'a@example.com', code: '123456' });
      const strip = (body: Record<string, unknown>) => {
        const copy = { ...body };
        delete copy.timestamp;
        delete copy.path;
        return copy;
      };
      expect(wrong.status).toBe(malformed.status);
      expect(strip(wrong.body)).toEqual(strip(malformed.body));
    });

    it('consume passes the token and guest header', async () => {
      await request(app.getHttpServer())
        .post('/auth/passwordless/consume')
        .send({ token: 'A'.repeat(43) })
        .expect(200);
      expect(service.consume).toHaveBeenCalledWith(
        'A'.repeat(43),
        expect.anything(),
        undefined,
      );
    });
  });
});
