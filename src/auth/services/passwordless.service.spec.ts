import * as nodeCrypto from 'crypto';
import {
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { PasswordlessService } from './passwordless.service';
import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { INCR_WITH_EXPIRY } from './passwordless-throttle.service';
import { PASSWORDLESS_REDIS_TIMEOUT_MS } from './passwordless.constants';
import {
  InMemoryAuthRepository,
  InMemoryLoginChallengeRepository,
  InMemoryRedis,
} from '@/shared/testing/passwordless-fakes';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    timingSafeEqual: jest.fn(actual.timingSafeEqual),
    randomInt: jest.fn(actual.randomInt),
    randomUUID: jest.fn(actual.randomUUID),
  };
});

const PEPPER = 'x'.repeat(48);
const NOW = new Date('2026-03-01T10:00:00.000Z');
const GENERIC = 'Invalid or expired code';

interface Captured {
  challengeId: string;
  email: string;
  code: string;
  linkToken: string;
}

function build() {
  const repo = new InMemoryLoginChallengeRepository();
  const redis = new InMemoryRedis();
  const authRepo = new InMemoryAuthRepository();
  const events = new EventEmitter2();
  const captured: Captured[] = [];
  events.on('passwordless.requested', (p: Captured) => captured.push(p));
  const config = {
    get: (k: string) =>
      ({
        PASSWORDLESS_PEPPER: PEPPER,
        WEB_APP_BASE_URL: 'https://app.test',
      })[k],
  };
  const tokenService = new TokenService(
    new JwtService({ secret: 'jwt-secret' }),
    authRepo as never,
  );
  const guestMerge = { carryOver: jest.fn().mockResolvedValue(undefined) };
  const service = new PasswordlessService(
    config as never,
    repo,
    new PasswordlessThrottleService(redis as never),
    authRepo as never,
    tokenService,
    {
      hashPassword: jest.fn().mockResolvedValue('hashed'),
    } as unknown as PasswordService,
    events,
    guestMerge as never,
  );
  return { service, repo, redis, authRepo, captured, guestMerge, events };
}

async function expectGeneric(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as BadRequestException).getResponse()).toEqual({
    message: GENERIC,
    error: 'Bad Request',
    statusCode: 400,
  });
}

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe('PasswordlessService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    (nodeCrypto.timingSafeEqual as jest.Mock).mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('request', () => {
    it('gives the same response for unknown and known emails, enqueues one email each and creates no user', async () => {
      const { service, authRepo, captured } = build();
      const findSpy = jest.spyOn(authRepo, 'findUserByEmail');
      await authRepo.createUser({
        email: 'known@example.com',
        passwordHash: 'h',
        role: 'parent',
      });
      authRepo.created.length = 0;
      findSpy.mockClear();

      const known = await service.request('known@example.com', '1.1.1.1');
      const unknown = await service.request('nobody@example.com', '2.2.2.2');

      expect(known).toEqual(unknown);
      expect(known).toEqual({
        message: expect.any(String),
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      expect(captured).toHaveLength(2);
      expect(authRepo.users).toHaveLength(1);
      expect(authRepo.created).toHaveLength(0);
      expect(findSpy).not.toHaveBeenCalled();
    });

    it('emits a 6-digit code and a 43 char base64url link token', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      expect(captured[0].code).toMatch(/^\d{6}$/);
      expect(captured[0].linkToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('stores only hashes, never the code or the link token', async () => {
      const { service, repo, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      const row = JSON.stringify(repo.rows);
      expect(row).not.toContain(captured[0].code + '"');
      expect(row).not.toContain(captured[0].linkToken);
      expect(row).not.toContain('1.1.1.1');
      expect(repo.rows[0].linkTokenHash).toBe(
        nodeCrypto
          .createHash('sha256')
          .update(captured[0].linkToken)
          .digest('hex'),
      );
    });

    it('a second request invalidates the first code and the first link', async () => {
      const { service, captured } = build();
      (nodeCrypto.randomInt as jest.Mock)
        .mockReturnValueOnce(111111)
        .mockReturnValueOnce(222222);
      await service.request('a@example.com', '1.1.1.1');
      jest.advanceTimersByTime(61_000);
      await service.request('a@example.com', '1.1.1.1');
      const [first, second] = captured;

      await expectGeneric(
        service.verify('a@example.com', first.code, '9.9.9.9'),
      );
      await expectGeneric(service.consume(first.linkToken, '9.9.9.9'));
      await expect(
        service.verify('a@example.com', second.code, '9.9.9.9'),
      ).resolves.toMatchObject({ isNewUser: true });
    });
  });

  describe('account creation budget', () => {
    const ipKey = (ip: string) =>
      `pwl:create:ip:${nodeCrypto.createHmac('sha256', PEPPER).update(ip).digest('hex')}`;
    const signIn = async (
      ctx: ReturnType<typeof build>,
      email: string,
      ip: string,
    ) => {
      await ctx.service.request(email, ip);
      const { code } = ctx.captured[ctx.captured.length - 1];
      return ctx.service.verify(email, code, ip);
    };
    const expectTooMany = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    };
    const spend = async (ctx: ReturnType<typeof build>, ip: string) => {
      for (const n of [1, 2, 3]) {
        await signIn(ctx, `fill${n}-${ip}@example.com`, ip);
      }
    };

    it('answers 429 and leaves the code unconsumed when the address spent its budget', async () => {
      const ctx = build();
      await spend(ctx, '203.0.113.9');
      await ctx.service.request('new4@example.com', '203.0.113.9');

      await expectTooMany(
        ctx.service.verify(
          'new4@example.com',
          ctx.captured[ctx.captured.length - 1].code,
          '203.0.113.9',
        ),
      );

      expect(
        ctx.authRepo.users.find((u) => u.email === 'new4@example.com'),
      ).toBeUndefined();
      expect(
        ctx.repo.rows.find((r) => r.emailNormalized === 'new4@example.com')
          ?.consumedAt,
      ).toBeNull();
    });

    it('answers 429 for the emailed link too when the budget is spent', async () => {
      const ctx = build();
      await spend(ctx, '203.0.113.9');
      await ctx.service.request('new4@example.com', '203.0.113.9');

      await expectTooMany(
        ctx.service.consume(
          ctx.captured[ctx.captured.length - 1].linkToken,
          '203.0.113.9',
        ),
      );
      expect(
        ctx.authRepo.users.find((u) => u.email === 'new4@example.com'),
      ).toBeUndefined();
    });

    it('still signs an existing account in from an address that spent its budget', async () => {
      const ctx = build();
      await ctx.authRepo.createUser({
        email: 'owner@example.com',
        passwordHash: 'h',
        isEmailVerified: true,
        role: 'parent',
      });
      await spend(ctx, '203.0.113.9');

      const result = await signIn(ctx, 'owner@example.com', '203.0.113.9');

      expect(result.isNewUser).toBe(false);
    });

    it('does not spend the budget of other addresses', async () => {
      const ctx = build();
      await spend(ctx, '203.0.113.9');

      const result = await signIn(ctx, 'other@example.com', '198.51.100.7');

      expect(result.isNewUser).toBe(true);
    });

    it('counts a mapped IPv6 address and the plain IPv4 address as one', async () => {
      const ctx = build();
      await spend(ctx, '203.0.113.9');
      await ctx.service.request('new4@example.com', '::ffff:203.0.113.9');

      await expectTooMany(
        ctx.service.verify(
          'new4@example.com',
          ctx.captured[ctx.captured.length - 1].code,
          '::ffff:203.0.113.9',
        ),
      );
    });

    it('caps creations per network across different addresses', async () => {
      const ctx = build();
      for (let host = 1; host <= 10; host++) {
        await signIn(ctx, `net${host}@example.com`, `198.51.100.${host}`);
      }
      await ctx.service.request('net11@example.com', '198.51.100.11');

      await expectTooMany(
        ctx.service.verify(
          'net11@example.com',
          ctx.captured[ctx.captured.length - 1].code,
          '198.51.100.11',
        ),
      );
    });

    it('does not spend the budget when an unverified account is taken over', async () => {
      const ctx = build();
      await ctx.authRepo.createUser({
        email: 'squat@example.com',
        passwordHash: 'attacker',
        isEmailVerified: false,
        role: 'parent',
      });

      const result = await signIn(ctx, 'squat@example.com', '203.0.113.9');

      expect(result.isNewUser).toBe(false);
      expect(await ctx.redis.client.get(ipKey('203.0.113.9'))).toBeNull();
    });

    it('does not spend the budget when the account is suspended', async () => {
      const ctx = build();
      const user = await ctx.authRepo.createUser({
        email: 'gone@example.com',
        passwordHash: 'h',
        isEmailVerified: true,
        role: 'parent',
      });
      user.isSuspended = true;

      await expectGeneric(signIn(ctx, 'gone@example.com', '203.0.113.9'));

      expect(await ctx.redis.client.get(ipKey('203.0.113.9'))).toBeNull();
    });

    it('spends the budget once when the sign-in loses a create race to the same email', async () => {
      const ctx = build();
      const create = ctx.authRepo.createUser;
      let raced = false;
      ctx.authRepo.createUser = async (data: Record<string, unknown>) => {
        if (raced) return create(data);
        raced = true;
        await create(data);
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['email'] },
        });
      };

      const result = await signIn(ctx, 'race@example.com', '203.0.113.9');

      expect(result.isNewUser).toBe(false);
      expect(await ctx.redis.client.get(ipKey('203.0.113.9'))).toBe('1');
    });

    it('refuses with a 503 and creates nothing when the throttle store is down', async () => {
      const ctx = build();
      await ctx.service.request('new@example.com', '203.0.113.9');
      const { code } = ctx.captured[0];
      ctx.redis.down = true;

      await expect(
        ctx.service.verify('new@example.com', code, '203.0.113.9'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(ctx.authRepo.users).toHaveLength(0);
      expect(ctx.repo.rows[0].consumedAt).toBeNull();
    });
  });

  describe('a stalled Redis connection', () => {
    const T = PASSWORDLESS_REDIS_TIMEOUT_MS;

    const existingOwner = async (ctx: ReturnType<typeof build>) => {
      await ctx.authRepo.createUser({
        email: 'owner@example.com',
        passwordHash: 'h',
        isEmailVerified: true,
        role: 'parent',
      });
      await ctx.service.request('owner@example.com', '203.0.113.9');
      return ctx.captured[ctx.captured.length - 1].code;
    };

    it('answers a request with 503 after one call timeout', async () => {
      const ctx = build();
      ctx.redis.hung = true;
      const outcome = ctx.service
        .request('owner@example.com', '203.0.113.9')
        .then(
          () => null,
          (error: unknown) => error,
        );

      await jest.advanceTimersByTimeAsync(T);

      expect(await outcome).toBeInstanceOf(ServiceUnavailableException);
      expect(ctx.captured).toHaveLength(0);
      expect(ctx.repo.rows).toHaveLength(0);
    });

    it('lets a verify through the fail-open limits within a few call timeouts', async () => {
      const ctx = build();
      const code = await existingOwner(ctx);
      ctx.redis.hung = true;
      const outcome = ctx.service.verify(
        'owner@example.com',
        code,
        '203.0.113.9',
      );

      await jest.advanceTimersByTimeAsync(4 * T);

      await expect(outcome).resolves.toMatchObject({ isNewUser: false });
    });

    it('lets a consume through the fail-open limits within a call timeout', async () => {
      const ctx = build();
      await existingOwner(ctx);
      const { linkToken } = ctx.captured[ctx.captured.length - 1];
      ctx.redis.hung = true;
      const outcome = ctx.service.consume(linkToken, '203.0.113.9');

      await jest.advanceTimersByTimeAsync(4 * T);

      await expect(outcome).resolves.toMatchObject({ isNewUser: false });
    });

    it('does not make the login wait for the known-network marker', async () => {
      const ctx = build();
      const code = await existingOwner(ctx);
      ctx.redis.hungCommands = ['set'];
      const settled = jest.fn();

      void ctx.service
        .verify('owner@example.com', code, '203.0.113.9')
        .then(settled);
      await jest.advanceTimersByTimeAsync(0);

      expect(settled).toHaveBeenCalledTimes(1);
    });
  });

  describe('verify and consume', () => {
    it('returns the login response shape plus isNewUser and a hashed session for a new user', async () => {
      const { service, captured, authRepo } = build();
      await service.request('New@Example.com ', '1.1.1.1');

      const res = await service.verify(
        'new@example.com',
        captured[0].code,
        '3.3.3.3',
      );

      expect(res).toEqual({
        user: expect.objectContaining({
          email: 'new@example.com',
          role: 'parent',
        }),
        jwt: expect.any(String),
        refreshToken: expect.any(String),
        isNewUser: true,
      });
      expect(authRepo.sessions).toHaveLength(1);
      expect(authRepo.sessions[0].token).toBe(
        nodeCrypto.createHash('sha256').update(res.refreshToken).digest('hex'),
      );
      expect(authRepo.sessions[0].token).not.toBe(res.refreshToken);
      expect(authRepo.created[0]).toMatchObject({
        role: 'parent',
        isEmailVerified: true,
        onboardingStatus: 'email_verified',
        profile: { create: { country: 'NG' } },
      });
      expect(authRepo.created[0].passwordHash).toBeTruthy();
    });

    it('logs an existing user in with isNewUser false and does not create one', async () => {
      const { service, captured, authRepo } = build();
      await authRepo.createUser({
        email: 'known@example.com',
        passwordHash: 'h',
        role: 'parent',
        isEmailVerified: false,
      });
      authRepo.created.length = 0;
      await service.request('known@example.com', '1.1.1.1');

      const res = await service.verify(
        'known@example.com',
        captured[0].code,
        '3.3.3.3',
      );

      expect(res.isNewUser).toBe(false);
      expect(authRepo.created).toHaveLength(0);
      expect(authRepo.users[0].isEmailVerified).toBe(true);
    });

    it('locks after 5 wrong codes so a 6th, correct, attempt still fails', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      const { code } = captured[0];
      for (let i = 0; i < 5; i++) {
        await expectGeneric(
          service.verify('a@example.com', wrongCode(code), `4.4.4.${i}`),
        );
      }
      await expectGeneric(service.verify('a@example.com', code, '4.4.4.9'));
      await expect(
        service.consume(captured[0].linkToken, '4.4.4.9'),
      ).resolves.toMatchObject({ isNewUser: true });
    });

    it('the code consumes the challenge so the link cannot be replayed', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3');
      await expectGeneric(service.consume(captured[0].linkToken, '3.3.3.3'));
    });

    it('the link consumes the challenge so the code cannot be replayed', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      await expect(
        service.consume(captured[0].linkToken, '3.3.3.3'),
      ).resolves.toMatchObject({ isNewUser: true });
      await expectGeneric(
        service.verify('a@example.com', captured[0].code, '3.3.3.3'),
      );
    });

    it('a used code cannot be used twice', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3');
      await expectGeneric(
        service.verify('a@example.com', captured[0].code, '3.3.3.3'),
      );
    });

    it('expires after 10 minutes for both the code and the link', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      jest.advanceTimersByTime(600_000 + 1);
      await expectGeneric(
        service.verify('a@example.com', captured[0].code, '3.3.3.3'),
      );
      await expectGeneric(service.consume(captured[0].linkToken, '3.3.3.3'));
    });

    it('still accepts the code one second before expiry', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      jest.advanceTimersByTime(599_000);
      await expect(
        service.verify('a@example.com', captured[0].code, '3.3.3.3'),
      ).resolves.toMatchObject({ isNewUser: true });
    });

    it('answers identically for wrong, unknown-email, malformed link, suspended and deleted', async () => {
      const { service, captured, authRepo } = build();
      await service.request('a@example.com', '1.1.1.1');
      await expectGeneric(
        service.verify('a@example.com', wrongCode(captured[0].code), '3.3.3.3'),
      );
      await expectGeneric(
        service.verify('ghost@example.com', '123456', '3.3.3.3'),
      );
      await expectGeneric(service.consume('A'.repeat(43), '3.3.3.3'));

      for (const flag of ['isSuspended', 'isDeleted'] as const) {
        const email = `${flag.toLowerCase()}@example.com`;
        const user = await authRepo.createUser({
          email,
          passwordHash: 'h',
          role: 'parent',
          isEmailVerified: true,
        });
        (user as unknown as Record<string, boolean>)[flag] = true;
        await service.request(email, '5.5.5.5');
        const last = captured[captured.length - 1];
        await expectGeneric(service.verify(email, last.code, '6.6.6.6'));
      }
      expect(authRepo.sessions).toHaveLength(0);
    });

    it('compares hashes with timingSafeEqual on equal-length buffers', async () => {
      const { service, captured } = build();
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3');
      const calls = (nodeCrypto.timingSafeEqual as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const [a, b] of calls) {
        expect(a.length).toBe(b.length);
        expect(a.length).toBe(32);
      }
    });

    it('still performs a constant-time compare when no challenge exists', async () => {
      const { service } = build();
      await expectGeneric(
        service.verify('ghost@example.com', '123456', '3.3.3.3'),
      );
      expect(nodeCrypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    });

    it('emits the admin activity event on login like password login', async () => {
      const { service, captured, events } = build();
      const seen: unknown[] = [];
      events.on('admin.sse.activity', (p) => seen.push(p));
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3');
      expect(seen).toContainEqual(expect.objectContaining({ type: 'LOGIN' }));
    });
  });

  describe('throttling', () => {
    it('answers 429 once one IP exceeds 10 requests in 15 minutes', async () => {
      const { service } = build();
      for (let i = 0; i < 10; i++) {
        await service.request(`u${i}@example.com`, '7.7.7.7');
      }
      const err = await service
        .request('u11@example.com', '7.7.7.7')
        .catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('silently drops (generic 200, no email) a repeat for the same email within 60 seconds', async () => {
      const { service, captured } = build();
      const first = await service.request('a@example.com', '1.1.1.1');
      const second = await service.request('a@example.com', '2.2.2.2');
      expect(second).toEqual(first);
      expect(captured).toHaveLength(1);
    });

    it('silently drops the 6th request for one email within an hour', async () => {
      const { service, captured } = build();
      for (let i = 0; i < 6; i++) {
        await service.request('a@example.com', `10.0.0.${i}`);
        jest.advanceTimersByTime(61_000);
      }
      expect(captured).toHaveLength(5);
    });

    it('applies the IP limit and the email limit independently', async () => {
      const { service, captured } = build();
      for (let i = 0; i < 10; i++) {
        await service.request(`u${i}@example.com`, '7.7.7.7');
      }
      await service.request('fresh-ip@example.com', '8.8.8.8');
      expect(captured).toHaveLength(11);
      await expect(
        service.request('another@example.com', '7.7.7.7'),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('stops sending once the global ceiling is reached', async () => {
      const { service, captured, redis } = build();
      for (let i = 0; i < 1000; i++) {
        await redis.client.eval(
          INCR_WITH_EXPIRY,
          1,
          'pwl:req:global',
          '3600000',
        );
      }
      await service.request('a@example.com', '1.1.1.1');
      expect(captured).toHaveLength(0);
    });

    it('fails closed with 503 and sends nothing when Redis is down', async () => {
      const { service, captured, repo, redis } = build();
      redis.down = true;
      await expect(
        service.request('a@example.com', '1.1.1.1'),
      ).rejects.toMatchObject({ status: 503 });
      expect(captured).toHaveLength(0);
      expect(repo.rows).toHaveLength(0);
    });

    it('lets the owner sign in from another network while a stranger is throttled, without moving the clock', async () => {
      const { service, captured } = build();
      const results: unknown[] = [];
      for (let i = 0; i < 22; i++) {
        results.push(
          await service
            .verify('owner@example.com', '123456', '66.66.66.6')
            .catch((e: HttpException) => e.getStatus()),
        );
      }
      expect(results.slice(0, 20).every((r) => r === 400)).toBe(true);
      expect(results[21]).toBe(429);

      await service.request('owner@example.com', '203.0.113.5');
      await expect(
        service.verify('owner@example.com', captured[0].code, '203.0.113.5'),
      ).resolves.toBeDefined();
    });

    it('still throttles one email across many networks at a high ceiling', async () => {
      const { service } = build();
      let last: unknown;
      for (let i = 0; i < 101; i++) {
        last = await service
          .verify('a@example.com', '123456', `20.${i}.0.1`)
          .catch((e: HttpException) => e.getStatus());
      }
      expect(last).toBe(429);
    });

    it('limits verify and consume together to 20 per IP per 15 minutes with 429', async () => {
      const { service } = build();
      const results: unknown[] = [];
      for (let i = 0; i < 21; i++) {
        results.push(
          await (
            i % 2
              ? service.verify(`e${i}@example.com`, '123456', '30.0.0.1')
              : service.consume('A'.repeat(43), '30.0.0.1')
          ).catch((e: HttpException) => e.getStatus()),
        );
      }
      expect(results[20]).toBe(429);
      expect(results.slice(0, 20).every((r) => r === 400)).toBe(true);
    });
  });

  describe('logging', () => {
    it('never logs the code, the link token or the full email', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (m) => jest.spyOn(Logger.prototype, m).mockImplementation(),
      );
      const { service, captured } = build();
      (nodeCrypto.randomUUID as jest.Mock).mockReturnValueOnce(
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      );
      await service.request('secret.person@example.com', '1.1.1.1');
      const guess = wrongCode(captured[0].code);
      await service
        .verify('secret.person@example.com', guess, '3.3.3.3')
        .catch(() => undefined);
      await service.verify(
        'secret.person@example.com',
        captured[0].code,
        '3.3.3.3',
      );
      await service
        .consume(captured[0].linkToken, '3.3.3.3')
        .catch(() => undefined);

      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).toContain(captured[0].challengeId);
      expect(logged).not.toContain(captured[0].code);
      expect(logged).not.toContain(guess);
      expect(logged).not.toContain(captured[0].linkToken);
      expect(logged).not.toContain('secret.person');
      expect(logged).not.toContain('1.1.1.1');
    });
  });

  describe('guest session carry-over', () => {
    const GUEST = '0b1f6b4e-7c1a-4a39-9a55-2f1f6f0f7a11';

    it('hands a new login to the carry-over with the header value', async () => {
      const { service, captured, guestMerge } = build();
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3', GUEST);
      expect(guestMerge.carryOver).toHaveBeenCalledWith(
        expect.any(String),
        GUEST,
        true,
      );
    });

    it('does nothing without a guest header', async () => {
      const { service, captured, guestMerge } = build();
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3');
      expect(guestMerge.carryOver).not.toHaveBeenCalled();
    });

    it('never fails the login when the carry-over throws', async () => {
      const { service, captured, guestMerge } = build();
      guestMerge.carryOver.mockRejectedValue(new Error('boom'));
      await service.request('a@example.com', '1.1.1.1');
      await expect(
        service.verify('a@example.com', captured[0].code, '3.3.3.3', GUEST),
      ).resolves.toMatchObject({ isNewUser: true });
    });

    it('does not carry over on a failed login', async () => {
      const { service, captured, guestMerge } = build();
      await service.request('a@example.com', '1.1.1.1');
      await expectGeneric(
        service.verify(
          'a@example.com',
          wrongCode(captured[0].code),
          '3.3.3.3',
          GUEST,
        ),
      );
      expect(guestMerge.carryOver).not.toHaveBeenCalled();
    });
  });

  describe('pre-account takeover', () => {
    async function seedAttackerAccount(
      authRepo: InMemoryAuthRepository,
      email: string,
      flags: Record<string, boolean> = {},
    ) {
      const user = await authRepo.createUser({
        email,
        passwordHash: 'attacker-chosen-hash',
        role: 'parent',
        isEmailVerified: false,
      });
      Object.assign(user, { hasLocalPassword: true, ...flags });
      await authRepo.createSession({
        userId: user.id,
        token: 'attacker-refresh',
        expiresAt: new Date(),
      });
      authRepo.created.length = 0;
      return user;
    }

    it('kills the attacker sessions and password when the owner signs in to an unverified account', async () => {
      const { service, captured, authRepo } = build();
      const user = await seedAttackerAccount(authRepo, 'victim@example.com');
      await service.request('victim@example.com', '1.1.1.1');

      const res = await service.verify(
        'victim@example.com',
        captured[0].code,
        '3.3.3.3',
      );

      expect(res.isNewUser).toBe(false);
      expect(authRepo.sessions.map((s) => s.token)).not.toContain(
        'attacker-refresh',
      );
      expect(authRepo.sessions).toHaveLength(1);
      expect(user.passwordHash).not.toBe('attacker-chosen-hash');
      expect(user.hasLocalPassword).toBe(false);
      expect(user.isEmailVerified).toBe(true);
      expect(user.onboardingStatus).toBe('email_verified');
    });

    it('does the same through the link', async () => {
      const { service, captured, authRepo } = build();
      const user = await seedAttackerAccount(authRepo, 'victim@example.com');
      await service.request('victim@example.com', '1.1.1.1');
      await service.consume(captured[0].linkToken, '3.3.3.3');
      expect(authRepo.sessions.map((s) => s.token)).not.toContain(
        'attacker-refresh',
      );
      expect(user.passwordHash).not.toBe('attacker-chosen-hash');
    });

    it('removes every other credential the attacker planted on the unverified account', async () => {
      const { service, captured, authRepo } = build();
      const user = await seedAttackerAccount(authRepo, 'victim@example.com');
      Object.assign(user, {
        googleId: 'attacker-google-sub',
        appleId: 'attacker-apple-sub',
        pinHash: 'attacker-pin',
        biometricsEnabled: true,
      });
      authRepo.deviceTokens.push({ userId: user.id, token: 'attacker-device' });
      authRepo.deviceTokens.push({ userId: 'someone-else', token: 'other' });
      await service.request('victim@example.com', '1.1.1.1');

      await service.verify('victim@example.com', captured[0].code, '3.3.3.3');

      expect(
        await authRepo.findUserByGoogleId('attacker-google-sub'),
      ).toBeNull();
      expect(await authRepo.findUserByAppleId('attacker-apple-sub')).toBeNull();
      expect(user.pinHash).toBeNull();
      expect(user.biometricsEnabled).toBe(false);
      expect(authRepo.deviceTokens).toEqual([
        { userId: 'someone-else', token: 'other' },
      ]);
    });

    it('keeps the linked providers and pin of an already verified account', async () => {
      const { service, captured, authRepo } = build();
      const user = await seedAttackerAccount(authRepo, 'owner@example.com');
      Object.assign(user, {
        isEmailVerified: true,
        googleId: 'owner-google-sub',
        pinHash: 'owner-pin',
        biometricsEnabled: true,
      });
      authRepo.deviceTokens.push({ userId: user.id, token: 'owner-device' });
      await service.request('owner@example.com', '1.1.1.1');

      await service.verify('owner@example.com', captured[0].code, '3.3.3.3');

      expect(user.googleId).toBe('owner-google-sub');
      expect(user.pinHash).toBe('owner-pin');
      expect(user.biometricsEnabled).toBe(true);
      expect(authRepo.deviceTokens).toHaveLength(1);
    });

    it('leaves the password and other sessions of an already verified account alone', async () => {
      const { service, captured, authRepo } = build();
      const user = await seedAttackerAccount(authRepo, 'owner@example.com');
      user.isEmailVerified = true;
      await service.request('owner@example.com', '1.1.1.1');
      await service.verify('owner@example.com', captured[0].code, '3.3.3.3');
      expect(user.passwordHash).toBe('attacker-chosen-hash');
      expect(authRepo.sessions.map((s) => s.token)).toContain(
        'attacker-refresh',
      );
    });

    it.each(['isSuspended', 'isDeleted'])(
      'does not verify or touch a %s account before refusing',
      async (flag) => {
        const { service, captured, authRepo } = build();
        const user = await seedAttackerAccount(
          authRepo,
          'blocked@example.com',
          { [flag]: true },
        );
        await service.request('blocked@example.com', '1.1.1.1');
        await expectGeneric(
          service.verify('blocked@example.com', captured[0].code, '3.3.3.3'),
        );
        expect(user.isEmailVerified).toBe(false);
        expect(user.passwordHash).toBe('attacker-chosen-hash');
        expect(authRepo.sessions.map((s) => s.token)).toContain(
          'attacker-refresh',
        );
      },
    );
  });

  describe('email case', () => {
    it('signs a mixed-case stored account in without creating a duplicate', async () => {
      const { service, captured, authRepo } = build();
      await authRepo.createUser({
        email: 'Mixed@Example.com',
        passwordHash: 'h',
        role: 'parent',
        isEmailVerified: true,
      });
      authRepo.created.length = 0;
      await service.request('mixed@example.com', '1.1.1.1');

      const res = await service.verify(
        'mixed@example.com',
        captured[0].code,
        '3.3.3.3',
      );

      expect(res.isNewUser).toBe(false);
      expect(authRepo.users).toHaveLength(1);
      expect(authRepo.created).toHaveLength(0);
    });
  });

  describe('registration events', () => {
    it('emits the register-path events for a new user', async () => {
      const { service, captured, events } = build();
      const seen: string[] = [];
      for (const name of [
        'user.registered',
        'admin.sse.activity',
        'admin.sse.stats',
      ]) {
        events.on(name, () => seen.push(name));
      }
      await service.request('new@example.com', '1.1.1.1');
      await service.verify('new@example.com', captured[0].code, '3.3.3.3');
      expect(seen).toEqual(
        expect.arrayContaining(['user.registered', 'admin.sse.stats']),
      );
      expect(seen.filter((n) => n === 'admin.sse.activity')).toHaveLength(2);
    });

    it('emits email verified for a previously unverified account and nothing for a verified one', async () => {
      const { service, captured, events, authRepo } = build();
      const seen: string[] = [];
      events.on('user.email_verified', () => seen.push('verified'));
      events.on('user.registered', () => seen.push('registered'));
      await authRepo.createUser({
        email: 'a@example.com',
        passwordHash: 'h',
        role: 'parent',
        isEmailVerified: false,
      });
      await authRepo.createUser({
        email: 'b@example.com',
        passwordHash: 'h',
        role: 'parent',
        isEmailVerified: true,
      });
      await service.request('a@example.com', '1.1.1.1');
      await service.verify('a@example.com', captured[0].code, '3.3.3.3');
      await service.request('b@example.com', '1.1.1.2');
      await service.verify('b@example.com', captured[1].code, '3.3.3.4');
      expect(seen).toEqual(['verified']);
    });
  });

  describe('global send ceiling', () => {
    it('is consumed only by real sends, not by refused or dropped requests', async () => {
      const { service, captured, redis } = build();
      for (let i = 0; i < 60; i++) {
        await service
          .request('flood@example.com', '9.9.9.9')
          .catch(() => undefined);
      }
      expect(await redis.client.get('pwl:req:global')).toBe(
        String(captured.length),
      );
      await service.request('fresh@example.com', '8.8.8.8');
      expect(captured[captured.length - 1]).toMatchObject({
        email: 'fresh@example.com',
      });
    });

    it('never lets concurrent requests exceed the ceiling', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { service, captured, redis } = build();
      for (let i = 0; i < 998; i++) {
        await redis.client.eval(
          INCR_WITH_EXPIRY,
          1,
          'pwl:req:global',
          '3600000',
        );
      }

      await Promise.all(
        [0, 1, 2, 3, 4, 5].map((i) =>
          service.request(`c${i}@example.com`, `50.${i}.0.1`),
        ),
      );

      expect(captured).toHaveLength(2);
      expect(await redis.client.get('pwl:req:global')).toBe('1000');
    });

    it('logs at error level when the ceiling trips', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { service, redis } = build();
      for (let i = 0; i < 1000; i++) {
        await redis.client.eval(
          INCR_WITH_EXPIRY,
          1,
          'pwl:req:global',
          '3600000',
        );
      }
      await service.request('a@example.com', '1.1.1.1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ceiling'));
    });
  });

  describe('long-term caps per email', () => {
    const quiet = () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      return jest.spyOn(Logger.prototype, 'error').mockImplementation();
    };

    it('stops sending after 10 emails from one network to one address in a day, with an error log', async () => {
      const errorSpy = quiet();
      const { service, captured } = build();
      for (let i = 0; i < 12; i++) {
        await service.request('target@example.com', '1.1.1.1');
        jest.advanceTimersByTime(13 * 60_000);
      }
      expect(captured).toHaveLength(10);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('daily'));
    });

    it('does not let a stranger burn the owner quota from another network', async () => {
      quiet();
      const { service, captured } = build();
      for (let i = 0; i < 12; i++) {
        await service.request('owner@example.com', '66.66.66.6');
        jest.advanceTimersByTime(13 * 60_000);
      }
      expect(captured).toHaveLength(10);

      await service.request('owner@example.com', '203.0.113.9');

      expect(captured).toHaveLength(11);
      expect(captured[10].email).toBe('owner@example.com');
    });

    it('applies a 60 per day ceiling per address across networks', async () => {
      const errorSpy = quiet();
      const { service, captured } = build();
      for (let i = 0; i < 63; i++) {
        await service.request('target@example.com', `10.${i}.0.1`);
        jest.advanceTimersByTime(13 * 60_000);
      }
      expect(captured).toHaveLength(60);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('daily'));
    });

    it('does not consume any send counter when the challenge cannot be stored', async () => {
      quiet();
      const { service, repo, redis } = build();
      jest
        .spyOn(repo, 'replaceOpenChallenge')
        .mockRejectedValueOnce(new Error('db'));

      await expect(
        service.request('target@example.com', '1.1.1.1'),
      ).rejects.toThrow('db');

      expect(Number((await redis.client.get('pwl:req:global')) ?? 0)).toBe(0);
    });

    it('does not count wrong codes against the address when no challenge is open', async () => {
      const errorSpy = quiet();
      const { service, captured } = build();
      for (let i = 0; i < 25; i++) {
        await expectGeneric(
          service.verify('target@example.com', '123456', `40.0.${i}.1`),
        );
        if (i % 9 === 8) jest.advanceTimersByTime(16 * 60_000);
      }
      jest.advanceTimersByTime(16 * 60_000);
      await service.request('target@example.com', '1.1.1.1');

      await expect(
        service.verify('target@example.com', captured[0].code, '41.0.0.1'),
      ).resolves.toBeDefined();
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('failed-attempt cap'),
      );
    });

    it('rejects further code verifies after 20 failed guesses but the link still signs in', async () => {
      const errorSpy = quiet();
      const { service, captured } = build();
      for (let round = 0; round < 4; round++) {
        await service.request('target@example.com', '1.1.1.1');
        const real = captured[captured.length - 1].code;
        for (let i = 0; i < 5; i++) {
          await expectGeneric(
            service.verify(
              'target@example.com',
              wrongCode(real),
              `40.0.${i}.1`,
            ),
          );
        }
        jest.advanceTimersByTime(16 * 60_000);
      }
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed-attempt cap'),
      );

      await service.request('target@example.com', '1.1.1.1');
      const latest = captured[captured.length - 1];
      await expectGeneric(
        service.verify('target@example.com', latest.code, '41.0.0.1'),
      );
      await expect(
        service.consume(latest.linkToken, '41.0.0.1'),
      ).resolves.toBeDefined();
    });

    it('compares at most 20 guesses per address per day even when verifies run concurrently', async () => {
      quiet();
      const { service, captured } = build();
      const compare = nodeCrypto.timingSafeEqual as unknown as jest.Mock;
      for (const used of [4, 4, 4, 4, 3]) {
        await service.request('target@example.com', '1.1.1.1');
        const real = captured[captured.length - 1].code;
        for (let i = 0; i < used; i++) {
          await expectGeneric(
            service.verify(
              'target@example.com',
              wrongCode(real),
              `40.0.${i}.1`,
            ),
          );
        }
        jest.advanceTimersByTime(16 * 60_000);
      }
      await service.request('target@example.com', '1.1.1.1');
      const real = captured[captured.length - 1].code;
      compare.mockClear();

      await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          service
            .verify('target@example.com', wrongCode(real), `41.0.${i}.1`)
            .catch(() => undefined),
        ),
      );

      expect(compare).toHaveBeenCalledTimes(1);
    });

    it('does not exempt a network that is only known for another address', async () => {
      quiet();
      const { service, captured } = build();
      await service.request('a@example.com', '203.0.113.5');
      await service.verify('a@example.com', captured[0].code, '203.0.113.5');
      jest.advanceTimersByTime(13 * 60_000);

      for (let i = 0; i < 12; i++) {
        await service.request('b@example.com', '203.0.113.5');
        jest.advanceTimersByTime(13 * 60_000);
      }

      expect(captured.filter((c) => c.email === 'b@example.com')).toHaveLength(
        10,
      );
    });

    it('does not count a wrong code against the address when the challenge turns out to be unusable', async () => {
      quiet();
      const { service, captured, repo, redis } = build();
      await service.request('target@example.com', '1.1.1.1');
      jest.spyOn(repo, 'recordAttempt').mockResolvedValueOnce(null);

      await expectGeneric(
        service.verify(
          'target@example.com',
          wrongCode(captured[0].code),
          '40.0.0.1',
        ),
      );

      const key = `pwl:fail:email:${nodeCrypto.createHmac('sha256', PEPPER).update('target@example.com').digest('hex')}`;
      expect(await redis.client.get(key)).toBeNull();
    });

    it('keeps the daily send backstop from being burned by strangers on a network the owner already signed in from', async () => {
      quiet();
      const { service, captured } = build();
      await service.request('owner@example.com', '203.0.113.5');
      await service.verify(
        'owner@example.com',
        captured[0].code,
        '203.0.113.5',
      );
      jest.advanceTimersByTime(13 * 60_000);

      for (let net = 0; net < 8; net++) {
        for (let i = 0; i < 10; i++) {
          await service.request('owner@example.com', `10.${net}.0.1`);
          jest.advanceTimersByTime(13 * 60_000);
        }
      }
      const before = captured.length;
      jest.advanceTimersByTime(61 * 60_000);
      await service.request('owner@example.com', '198.51.100.9');
      expect(captured).toHaveLength(before);

      jest.advanceTimersByTime(61 * 60_000);
      await service.request('owner@example.com', '203.0.113.77');
      expect(captured).toHaveLength(before + 1);
    });

    it('does not count a correct code toward the failed-attempt cap', async () => {
      const { service, captured, redis } = build();
      await service.request('target@example.com', '1.1.1.1');

      await service.verify('target@example.com', captured[0].code, '41.0.0.1');

      const key = `pwl:fail:email:${nodeCrypto.createHmac('sha256', PEPPER).update('target@example.com').digest('hex')}`;
      expect(Number((await redis.client.get(key)) ?? 0)).toBe(0);
    });

    it('keeps signing the owner in after more successful logins than the failed-attempt cap', async () => {
      const { service, captured } = build();
      for (let i = 0; i < 22; i++) {
        await service.request('owner@example.com', '203.0.113.5');
        await expect(
          service.verify(
            'owner@example.com',
            captured[captured.length - 1].code,
            '203.0.113.5',
          ),
        ).resolves.toBeDefined();
        jest.advanceTimersByTime(61 * 60_000);
      }
    });

    it('signs nobody in when several verified accounts match the email and none is the exact case', async () => {
      const { service, captured, authRepo } = build();
      for (const email of ['Dup@example.com', 'dUp@example.com']) {
        await authRepo.createUser({
          email,
          passwordHash: 'h',
          isEmailVerified: true,
          role: 'parent',
        });
      }
      await service.request('dup@example.com', '1.1.1.1');

      await expectGeneric(
        service.verify('dup@example.com', captured[0].code, '41.0.0.1'),
      );

      expect(authRepo.sessions).toHaveLength(0);
      expect(authRepo.users).toHaveLength(2);
    });

    it('refuses a code whose challenge expires while the verification is in flight', async () => {
      const { service, captured, repo } = build();
      await service.request('target@example.com', '1.1.1.1');
      jest.advanceTimersByTime(600_000 - 1000);
      const record = repo.recordAttempt.bind(repo);
      jest.spyOn(repo, 'recordAttempt').mockImplementation(async (...args) => {
        const attempt = await record(...args);
        jest.advanceTimersByTime(2000);
        return attempt;
      });

      await expectGeneric(
        service.verify('target@example.com', captured[0].code, '41.0.0.1'),
      );
    });

    it('lets the right code through before the cap is reached', async () => {
      const { service, captured } = build();
      await service.request('target@example.com', '1.1.1.1');
      for (let i = 0; i < 4; i++) {
        await expectGeneric(
          service.verify(
            'target@example.com',
            wrongCode(captured[0].code),
            `40.0.${i}.1`,
          ),
        );
      }
      await expect(
        service.verify('target@example.com', captured[0].code, '41.0.0.1'),
      ).resolves.toBeDefined();
    });
  });
});
