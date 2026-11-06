import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { OnboardingService } from './onboarding.service';
import { EmailVerificationService } from './email-verification.service';
import { VerifyFirstService } from './verify-first.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { findOrCreateParentByVerifiedEmail } from './verified-email-user';
import { AuthService } from '../auth.service';
import { PrismaAuthRepository } from '../repositories/prisma-auth.repository';

const url = process.env.PASSWORDLESS_TEST_DATABASE_URL;
const maybe = url && /throwaway|_test/.test(url) ? describe : describe.skip;

const PASSWORD = 'Sup3rSecret#pw';
const INVALID = 'Invalid or expired code';

maybe('verify-first registration against Postgres', () => {
  let prisma: PrismaClient;
  let authRepo: PrismaAuthRepository;
  let onboarding: OnboardingService;
  let emailVerification: EmailVerificationService;
  let verifyFirst: VerifyFirstService;
  let authService: AuthService;
  let passwordService: PasswordService;
  const codes = new Map<string, string>();
  let n = 0;

  const emailFor = () => `vf-it-${process.pid}-${++n}@example.com`;
  const registerDto = (email: string) => ({
    email,
    password: PASSWORD,
    fullName: 'Verify First',
  });
  const wrongCode = (code: string) => (code === '123456' ? '654321' : '123456');
  const tokenRow = (email: string) =>
    prisma.token.findFirstOrThrow({
      where: { user: { email }, type: 'verification' },
    });
  const failure = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as { status: number; getResponse(): unknown };
    }
    throw new Error('expected rejection');
  };

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const events = new EventEmitter2();
    events.on(
      'email.verification_requested',
      (p: { email: string; token: string }) => codes.set(p.email, p.token),
    );
    authRepo = new PrismaAuthRepository(prisma as never);
    const tokenService = new TokenService(
      new JwtService({ secret: 's' }),
      authRepo,
    );
    passwordService = new PasswordService(authRepo, events, tokenService);
    emailVerification = new EmailVerificationService(
      authRepo,
      tokenService,
      events,
    );
    onboarding = new OnboardingService(
      authRepo,
      passwordService,
      tokenService,
      events,
      { get: () => undefined } as never,
      emailVerification,
    );
    verifyFirst = new VerifyFirstService(
      authRepo,
      tokenService,
      passwordService,
      events,
    );
    authService = new AuthService(authRepo, tokenService, events);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'vf-it-' } },
    });
    await prisma.$disconnect();
  });

  describe('POST v2 register', () => {
    it('creates the user and a code but no session, and returns no tokens', async () => {
      const email = emailFor();
      const res = await onboarding.registerV2(registerDto(email));

      expect(res).toEqual({
        user: expect.objectContaining({ email }),
        requiresEmailVerification: true,
      });
      expect(res).not.toHaveProperty('jwt');
      expect(res).not.toHaveProperty('refreshToken');
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({
        isEmailVerified: false,
        onboardingStatus: 'account_created',
      });
      expect(user.verifyFirstRegisteredAt).not.toBeNull();
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
      expect((await tokenRow(email)).attempts).toBe(0);
      expect(codes.get(email)).toMatch(/^\d{6}$/);
    });

    it('rejects an existing email exactly as v1 does', async () => {
      const email = emailFor();
      await onboarding.register(registerDto(email));
      const v1 = await failure(onboarding.register(registerDto(email)));
      const v2 = await failure(onboarding.registerV2(registerDto(email)));
      expect(v2.status).toBe(v1.status);
      expect(v2.getResponse()).toEqual(v1.getResponse());
    });
  });

  describe('POST v2 verify-email', () => {
    it('verifies, issues exactly one session and keeps the chosen password', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const before = await prisma.user.findUniqueOrThrow({ where: { email } });

      const res = await verifyFirst.verifyEmail(email, codes.get(email)!);

      expect(res.message).toBe('Email verified successfully');
      expect(res.user).toMatchObject({ email });
      expect(res.jwt).toEqual(expect.any(String));
      expect(res.refreshToken).toEqual(expect.any(String));
      const after = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(after).toMatchObject({
        isEmailVerified: true,
        onboardingStatus: 'email_verified',
        passwordHash: before.passwordHash,
      });
      expect(await prisma.session.count({ where: { userId: after.id } })).toBe(
        1,
      );
      const login = await authService.login({ email, password: PASSWORD });
      expect(login?.jwt).toEqual(expect.any(String));
    });

    it('rejects a valid code presented with another email, identically', async () => {
      const victim = emailFor();
      const other = emailFor();
      await onboarding.registerV2(registerDto(victim));
      await onboarding.registerV2(registerDto(other));
      const code = codes.get(victim)!;

      const wrongEmail = await failure(verifyFirst.verifyEmail(other, code));
      const wrongCodeErr = await failure(
        verifyFirst.verifyEmail(victim, wrongCode(code)),
      );

      expect(wrongEmail.status).toBe(400);
      expect(wrongEmail.getResponse()).toEqual(wrongCodeErr.getResponse());
      expect((await tokenRow(victim)).attempts).toBe(1);
      await expect(
        verifyFirst.verifyEmail(victim, code),
      ).resolves.toBeDefined();
    });

    it('gives one identical error for every failure mode', async () => {
      const bodies: unknown[] = [];
      const record = async (p: Promise<unknown>) => {
        const e = await failure(p);
        expect(e.status).toBe(400);
        bodies.push(e.getResponse());
      };

      const unknown = emailFor();
      await record(verifyFirst.verifyEmail(unknown, '123456'));

      const noToken = emailFor();
      await onboarding.registerV2(registerDto(noToken));
      await prisma.token.deleteMany({ where: { user: { email: noToken } } });
      await record(verifyFirst.verifyEmail(noToken, '123456'));

      const wrong = emailFor();
      await onboarding.registerV2(registerDto(wrong));
      await record(
        verifyFirst.verifyEmail(wrong, wrongCode(codes.get(wrong)!)),
      );

      const expired = emailFor();
      await onboarding.registerV2(registerDto(expired));
      await prisma.token.updateMany({
        where: { user: { email: expired } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await record(verifyFirst.verifyEmail(expired, codes.get(expired)!));

      const used = emailFor();
      await onboarding.registerV2(registerDto(used));
      const usedCode = codes.get(used)!;
      await verifyFirst.verifyEmail(used, usedCode);
      await record(verifyFirst.verifyEmail(used, usedCode));

      const locked = emailFor();
      await onboarding.registerV2(registerDto(locked));
      const lockedCode = codes.get(locked)!;
      for (let i = 0; i < 5; i++) {
        await failure(verifyFirst.verifyEmail(locked, wrongCode(lockedCode)));
      }
      await record(verifyFirst.verifyEmail(locked, lockedCode));

      const suspended = emailFor();
      await onboarding.registerV2(registerDto(suspended));
      await prisma.user.update({
        where: { email: suspended },
        data: { isSuspended: true },
      });
      await record(verifyFirst.verifyEmail(suspended, codes.get(suspended)!));

      expect(bodies).toHaveLength(7);
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(JSON.stringify(bodies[0])).toContain(INVALID);
    });

    it('does not consume a session for any failed attempt', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      await failure(
        verifyFirst.verifyEmail(email, wrongCode(codes.get(email)!)),
      );
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(
        0,
      );
    });

    it('counts parallel wrong guesses exactly and then locks the code', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const code = codes.get(email)!;
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          verifyFirst.verifyEmail(email, wrongCode(code)),
        ),
      );
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect((await tokenRow(email)).attempts).toBe(5);
      await failure(verifyFirst.verifyEmail(email, code));
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(
        0,
      );
    });

    it('lets a fresh code from a resend work after a lockout', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const first = codes.get(email)!;
      for (let i = 0; i < 5; i++) {
        await failure(verifyFirst.verifyEmail(email, wrongCode(first)));
      }
      await emailVerification.sendEmailVerification(email);
      await expect(
        verifyFirst.verifyEmail(email, codes.get(email)!),
      ).resolves.toBeDefined();
    });

    it('lets exactly one of many parallel verifies with the right code succeed', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const code = codes.get(email)!;
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => verifyFirst.verifyEmail(email, code)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(
        1,
      );
    });

    it('rejects a replay of a used code', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const code = codes.get(email)!;
      await verifyFirst.verifyEmail(email, code);
      await failure(verifyFirst.verifyEmail(email, code));
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(
        1,
      );
    });

    it('emits the verified event once', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const events = new EventEmitter2();
      const seen: unknown[] = [];
      events.on('user.email_verified', (p) => seen.push(p));
      const service = new VerifyFirstService(
        authRepo,
        new TokenService(new JwtService({ secret: 's' }), authRepo),
        passwordService,
        events,
      );
      await service.verifyEmail(email, codes.get(email)!);
      expect(seen).toEqual([expect.objectContaining({ email })]);
    });
  });

  describe('pre-verification takeover wipe', () => {
    const seedTouched = async (email: string) => {
      const reg = await onboarding.register(registerDto(email));
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: `g-${email}`,
          appleId: `a-${email}`,
          pinHash: 'pin',
          biometricsEnabled: true,
        },
      });
      await prisma.deviceToken.create({
        data: {
          userId: user.id,
          token: `dev-${email}`,
          platform: 'ios',
        },
      });
      return { user, reg };
    };

    it('fully wipes a v1-registered account and ends with one session', async () => {
      const email = emailFor();
      const { user, reg } = await seedTouched(email);
      expect(reg?.jwt).toEqual(expect.any(String));
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        1,
      );

      await emailVerification.sendEmailVerification(email);
      const res = await verifyFirst.verifyEmail(email, codes.get(email)!);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after).toMatchObject({
        isEmailVerified: true,
        hasLocalPassword: false,
        googleId: null,
        appleId: null,
        pinHash: null,
        biometricsEnabled: false,
      });
      expect(after.passwordHash).not.toBe(user.passwordHash);
      expect(
        await prisma.deviceToken.count({ where: { userId: user.id } }),
      ).toBe(0);
      const sessions = await prisma.session.findMany({
        where: { userId: user.id },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].token).toBe(
        crypto.createHash('sha256').update(res.refreshToken).digest('hex'),
      );
      await expect(
        authService.login({ email, password: PASSWORD }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('wipes sessions, links, pin, biometrics and devices of a v2 account but keeps its password', async () => {
      const email = emailFor();
      await onboarding.registerV2(registerDto(email));
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: `g-${email}`,
          pinHash: 'pin',
          biometricsEnabled: true,
        },
      });
      await prisma.session.create({
        data: {
          userId: user.id,
          token: crypto.randomBytes(8).toString('hex'),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await verifyFirst.verifyEmail(email, codes.get(email)!);

      const after = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(after).toMatchObject({
        googleId: null,
        pinHash: null,
        biometricsEnabled: false,
        passwordHash: user.passwordHash,
      });
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        1,
      );
      await expect(
        authService.login({ email, password: PASSWORD }),
      ).resolves.toBeDefined();
    });
  });

  describe('v1 register and verify-email stay as they were', () => {
    it('v1 register returns tokens and creates a session', async () => {
      const email = emailFor();
      const res = await onboarding.register(registerDto(email));
      expect(res).toEqual({
        user: expect.objectContaining({ email }),
        jwt: expect.any(String),
        refreshToken: expect.any(String),
      });
      expect(res).not.toHaveProperty('requiresEmailVerification');
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(
        1,
      );
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.verifyFirstRegisteredAt).toBeNull();
    });

    it('v1 verify-email returns only a message', async () => {
      const email = emailFor();
      await onboarding.register(registerDto(email));
      const res = await emailVerification.verifyEmail(codes.get(email)!);
      expect(res).toEqual({ message: 'Email verified successfully' });
    });

    it('sessions a v1 registration created are revoked when the account is verified through a verified-email path', async () => {
      const email = emailFor();
      await onboarding.register(registerDto(email));
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        1,
      );

      await findOrCreateParentByVerifiedEmail(
        { authRepository: authRepo, passwordService },
        { email, emailVerified: true },
      );

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });
  });
});
