import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthV2Controller } from './auth-v2.controller';
import { AuthService } from './auth.service';
import { OAuthService } from './services/oauth.service';
import { OnboardingService } from './services/onboarding.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';
import { AccountLinkingService } from './services/account-linking.service';
import { VerifyFirstService } from './services/verify-first.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { HttpExceptionFilter } from '@/shared/filters/http-exception.filter';
import { applyApiPrefix } from '@/shared/config/api-prefix';
import { throttleConfig } from '@/shared/config/throttle.config';

const registerBody = {
  email: 'new@example.com',
  password: 'Sup3rSecret#pw',
  fullName: 'New Parent',
};

async function makeApp(
  env: Record<string, unknown> = {},
  throttling = false,
): Promise<{
  app: INestApplication;
  onboarding: { register: jest.Mock; registerV2: jest.Mock };
  verifyFirst: { verifyEmail: jest.Mock };
  emailVerification: { verifyEmail: jest.Mock };
}> {
  const onboarding = {
    register: jest.fn().mockResolvedValue({
      user: { email: registerBody.email },
      jwt: 'jwt',
      refreshToken: 'refresh',
    }),
    registerV2: jest.fn().mockResolvedValue({
      user: { email: registerBody.email },
      requiresEmailVerification: true,
    }),
  };
  const verifyFirst = {
    verifyEmail: jest.fn().mockResolvedValue({
      message: 'Email verified successfully',
      user: { email: registerBody.email },
      jwt: 'jwt',
      refreshToken: 'refresh',
    }),
  };
  const emailVerification = {
    verifyEmail: jest.fn().mockResolvedValue({ message: 'ok' }),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({ throttlers: throttleConfig.throttlers }),
    ],
    controllers: [AuthController, AuthV2Controller],
    providers: [
      ...(throttling ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : []),
      { provide: AuthService, useValue: {} },
      { provide: OAuthService, useValue: {} },
      { provide: OnboardingService, useValue: onboarding },
      { provide: EmailVerificationService, useValue: emailVerification },
      { provide: VerifyFirstService, useValue: verifyFirst },
      { provide: PasswordService, useValue: {} },
      { provide: AccountLinkingService, useValue: {} },
      { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
    ],
  })
    .overrideGuard(AuthSessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(GoogleAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication();
  applyApiPrefix(app);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return { app, onboarding, verifyFirst, emailVerification };
}

describe('API v2 register and verify-email', () => {
  describe('routing', () => {
    let ctx: Awaited<ReturnType<typeof makeApp>>;
    beforeAll(async () => (ctx = await makeApp()));
    afterAll(() => ctx.app.close());
    beforeEach(() => jest.clearAllMocks());

    it('serves v2 register under /api/v2 and returns no tokens', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v2/auth/register')
        .send(registerBody)
        .expect(200);
      expect(res.body).toEqual({
        user: { email: registerBody.email },
        requiresEmailVerification: true,
      });
      expect(ctx.onboarding.registerV2).toHaveBeenCalledTimes(1);
      expect(ctx.onboarding.register).not.toHaveBeenCalled();
    });

    it('serves v2 verify-email bound to the email and returns the login shape', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v2/auth/verify-email')
        .send({ email: 'New@Example.com ', token: '123456' })
        .expect(200);
      expect(res.body).toEqual({
        message: 'Email verified successfully',
        user: { email: registerBody.email },
        jwt: 'jwt',
        refreshToken: 'refresh',
      });
      expect(ctx.verifyFirst.verifyEmail).toHaveBeenCalledWith(
        'new@example.com',
        '123456',
      );
    });

    it('rejects a v2 verify-email without an email', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v2/auth/verify-email')
        .send({ token: '123456' })
        .expect(400);
      expect(ctx.verifyFirst.verifyEmail).not.toHaveBeenCalled();
    });

    it('keeps v1 register returning tokens at the old path', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerBody)
        .expect(200);
      expect(res.body).toEqual({
        user: { email: registerBody.email },
        jwt: 'jwt',
        refreshToken: 'refresh',
      });
      expect(ctx.onboarding.register).toHaveBeenCalledTimes(1);
      expect(ctx.onboarding.registerV2).not.toHaveBeenCalled();
    });

    it('keeps v1 verify-email token-only returning a message', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: '123456' })
        .expect(200);
      expect(res.body).toEqual({ message: 'ok' });
      expect(ctx.emailVerification.verifyEmail).toHaveBeenCalledWith('123456');
    });

    it.each([
      '/api/v1/api/v2/auth/register',
      '/api/v1/v2/auth/register',
      '/auth/register',
      '/api/v2/auth/login',
    ])('does not expose %s', async (path) => {
      await request(ctx.app.getHttpServer())
        .post(path)
        .send(registerBody)
        .expect(404);
    });

    it('lists both versions in the swagger document', () => {
      const doc = SwaggerModule.createDocument(
        ctx.app,
        new DocumentBuilder().build(),
      );
      expect(Object.keys(doc.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/auth/register',
          '/api/v1/auth/verify-email',
          '/api/v2/auth/register',
          '/api/v2/auth/verify-email',
        ]),
      );
    });
  });

  describe('REGISTER_V2_ENABLED off', () => {
    let ctx: Awaited<ReturnType<typeof makeApp>>;
    beforeAll(
      async () => (ctx = await makeApp({ REGISTER_V2_ENABLED: false })),
    );
    afterAll(() => ctx.app.close());

    it.each(['register', 'verify-email'])(
      'v2 %s is 404 and v1 still works',
      async (route) => {
        await request(ctx.app.getHttpServer())
          .post(`/api/v2/auth/${route}`)
          .send({ ...registerBody, token: '123456' })
          .expect(404);
        expect(ctx.onboarding.registerV2).not.toHaveBeenCalled();
        expect(ctx.verifyFirst.verifyEmail).not.toHaveBeenCalled();
        await request(ctx.app.getHttpServer())
          .post('/api/v1/auth/register')
          .send(registerBody)
          .expect(200);
      },
    );
  });

  describe('v1 register deprecation signal', () => {
    it('adds no headers when REGISTER_V1_SUNSET is unset', async () => {
      const { app } = await makeApp();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerBody)
        .expect(200);
      expect(res.headers).not.toHaveProperty('deprecation');
      expect(res.headers).not.toHaveProperty('sunset');
      await app.close();
    });

    it('adds Deprecation and Sunset to v1 register only when set', async () => {
      const { app } = await makeApp({
        REGISTER_V1_SUNSET: '2027-03-01T00:00:00Z',
      });
      const v1 = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerBody)
        .expect(200);
      expect(v1.headers.deprecation).toBe('true');
      expect(v1.headers.sunset).toBe('Mon, 01 Mar 2027 00:00:00 GMT');

      const v1Verify = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: '123456' })
        .expect(200);
      expect(v1Verify.headers).not.toHaveProperty('deprecation');

      const v2 = await request(app.getHttpServer())
        .post('/api/v2/auth/register')
        .send(registerBody)
        .expect(200);
      expect(v2.headers).not.toHaveProperty('deprecation');
      expect(v2.headers).not.toHaveProperty('sunset');
      await app.close();
    });
  });

  describe('throttling', () => {
    it('limits v2 verify-email per IP across different emails', async () => {
      const { app, verifyFirst } = await makeApp({}, true);
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v2/auth/verify-email')
          .send({ email: `user${i}@example.com`, token: '123456' });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses.slice(5)).toEqual([429, 429]);
      expect(verifyFirst.verifyEmail).toHaveBeenCalledTimes(5);
      await app.close();
    });

    it('limits v2 verify-email per email', async () => {
      const { app } = await makeApp({}, true);
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v2/auth/verify-email')
          .send({ email: 'same@example.com', token: '123456' });
        statuses.push(res.status);
      }
      expect(statuses[5]).toBe(429);
      await app.close();
    });
  });
});
