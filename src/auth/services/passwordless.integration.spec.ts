import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PasswordlessService } from './passwordless.service';
import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { TokenService } from './token.service';
import * as bcrypt from 'bcryptjs';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PasswordService } from './password.service';
import {
  AccountAlreadyVerifiedError,
  PrismaAuthRepository,
} from '../repositories/prisma-auth.repository';
import { AmbiguousEmailAccountError } from '../repositories/ambiguous-email-account.error';
import { TakeoverTargetChangedError } from '../repositories/takeover-target-changed.error';
import { InactiveAccountError } from '../repositories/inactive-account.error';
import { PrismaLoginChallengeRepository } from '../repositories/prisma-login-challenge.repository';
import { InMemoryRedis } from '@/shared/testing/passwordless-fakes';
import { isThrowawayDatabaseUrl } from '@/shared/testing/throwaway-database';
import { findOrCreateParentByVerifiedEmail } from './verified-email-user';
import { PrismaDeviceTokenRepository } from '@/notification/repositories/prisma-device-token.repository';
import { PrismaGuestRepository } from '@/guest/repositories/prisma-guest.repository';
import { AccountLinkingService } from './account-linking.service';
import { PrismaAdminUserRepository } from '@/admin/repositories/prisma-admin-user.repository';
import { DeviceTokenService } from '@/notification/services/device-token.service';

const url = process.env.PASSWORDLESS_TEST_DATABASE_URL;
const maybe = isThrowawayDatabaseUrl(url) ? describe : describe.skip;
const LOCK_OBSERVATION_MS = 10_000;

maybe('PasswordlessService against Postgres', () => {
  jest.setTimeout(LOCK_OBSERVATION_MS * 3);
  let prisma: PrismaClient;
  const captured: Array<{
    challengeId: string;
    code: string;
    linkToken: string;
  }> = [];
  let service: PasswordlessService;
  let n = 0;
  const run = crypto.randomBytes(6).toString('hex');

  const emailFor = () => `pwl-it-${run}-${++n}@example.com`;
  const issue = async (email: string) => {
    await service.request(email, `10.${n % 250}.0.1`);
    return captured[captured.length - 1];
  };
  const rowFor = (email: string) =>
    prisma.loginChallenge.findFirstOrThrow({
      where: { emailNormalized: email },
      orderBy: { createdAt: 'desc' },
    });

  const waitForBlockedStatement = async (
    queryLike: string,
    timeoutMs = LOCK_OBSERVATION_MS,
    stop?: AbortSignal,
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (stop?.aborted) return;
      const blocked = await prisma.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE ${queryLike}`;
      if (blocked.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `no statement matching ${queryLike} was blocked on a lock within ${timeoutMs}ms`,
    );
  };

  const gateTransactionStep = (
    model: 'user' | 'token' | 'session',
    method: 'delete' | 'deleteMany' | 'update',
  ) => {
    let reached: () => void = () => undefined;
    let release: () => void = () => undefined;
    const reachedStep = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const bound = <T extends object>(target: T) =>
      new Proxy(target, {
        get: (t, key) => {
          const value = Reflect.get(t, key) as unknown;
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(t)
            : value;
        },
      });
    const gatedTx = (tx: Record<string, unknown>) =>
      new Proxy(tx, {
        get: (t, key) => {
          if (key !== model) return bound(t)[key as never];
          const delegate = t[model] as Record<string, unknown>;
          return new Proxy(delegate, {
            get: (d, name) =>
              name === method
                ? async (...args: unknown[]) => {
                    reached();
                    await gate;
                    return (d[method] as (...a: unknown[]) => unknown)(...args);
                  }
                : bound(d)[name as never],
          });
        },
      });
    const client = new Proxy(prisma, {
      get: (target, key) =>
        key === '$transaction'
          ? (fn: (tx: Record<string, unknown>) => unknown) =>
              target.$transaction((tx) => fn(gatedTx(tx as never)) as never)
          : bound(target)[key as never],
    });
    return { client, reached: reachedStep, release };
  };

  const blockedBeforeSettled = async (
    operation: Promise<unknown>,
    queryLike: string,
    timeoutMs = LOCK_OBSERVATION_MS,
  ) => {
    const stop = new AbortController();
    const observer = waitForBlockedStatement(queryLike, timeoutMs, stop.signal);
    const settledFirst = operation.then((outcome) => {
      throw new Error(
        `operation settled before blocking on a lock: ${String(outcome)}`,
      );
    });
    settledFirst.catch(() => undefined);
    try {
      await Promise.race([observer, settledFirst]);
    } finally {
      stop.abort();
      await observer.catch(() => undefined);
    }
  };

  const drainOnFailure = async (
    holder: Promise<unknown>,
    contender: () => Promise<unknown>,
  ) => {
    try {
      await holder;
    } catch (error) {
      await contender().catch(() => undefined);
      throw error;
    }
  };

  const untilReached = async (
    reached: Promise<void>,
    operation: Promise<unknown>,
    release: () => void,
  ) => {
    const settledFirst = operation.then((outcome) => {
      throw new Error(
        `operation settled before reaching the gate: ${String(outcome)}`,
      );
    });
    settledFirst.catch(() => undefined);
    try {
      await Promise.race([reached, settledFirst]);
    } catch (error) {
      release();
      await operation;
      throw error;
    }
  };

  const releaseAfter = async (
    observed: Promise<unknown>,
    release: () => void,
    started: Promise<unknown>[],
  ) => {
    try {
      await observed;
    } finally {
      release();
      await Promise.allSettled(started);
    }
  };

  beforeAll(() => {
    const pooled = new URL(url!);
    pooled.searchParams.set('connection_limit', '10');
    prisma = new PrismaClient({
      datasources: { db: { url: pooled.toString() } },
      transactionOptions: { timeout: LOCK_OBSERVATION_MS * 2 },
    });
    const events = new EventEmitter2();
    events.on(
      'passwordless.requested',
      (p: { challengeId: string; code: string; linkToken: string }) =>
        captured.push(p),
    );
    const authRepo = new PrismaAuthRepository(prisma as never);
    service = new PasswordlessService(
      {
        get: (k: string) => ({ PASSWORDLESS_PEPPER: 'p'.repeat(40) })[k],
      } as never,
      new PrismaLoginChallengeRepository(prisma as never),
      new PasswordlessThrottleService(new InMemoryRedis() as never),
      authRepo,
      new TokenService(new JwtService({ secret: 's' }), authRepo),
      { hashPassword: () => Promise.resolve('hashed-random') } as never,
      events,
      { carryOver: () => Promise.resolve() } as never,
    );
  });

  afterAll(async () => {
    try {
      await prisma.loginChallenge.deleteMany({
        where: { emailNormalized: { contains: run, mode: 'insensitive' } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: run, mode: 'insensitive' } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('has the login_challenges table with the unique link hash index', async () => {
    const idx = await prisma.$queryRaw<
      Array<{ name: string; isUnique: boolean; columns: string[] }>
    >`
      SELECT i.relname AS name,
             x.indisunique AS "isUnique",
             array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_index x
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'login_challenges' AND ns.nspname = current_schema()
      GROUP BY i.relname, x.indisunique
      ORDER BY i.relname`;
    expect(idx).toEqual([
      {
        name: 'login_challenges_emailNormalized_createdAt_idx',
        isUnique: false,
        columns: ['emailNormalized', 'createdAt'],
      },
      {
        name: 'login_challenges_expiresAt_idx',
        isUnique: false,
        columns: ['expiresAt'],
      },
      {
        name: 'login_challenges_linkTokenHash_key',
        isUnique: true,
        columns: ['linkTokenHash'],
      },
      { name: 'login_challenges_pkey', isUnique: true, columns: ['id'] },
    ]);
  });

  it('creates the user, a hashed session row and marks the challenge consumed', async () => {
    const email = emailFor();
    const { code } = await issue(email);
    const res = await service.verify(email, code, '1.2.3.4');

    expect(res.isNewUser).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({
      role: 'parent',
      isEmailVerified: true,
      onboardingStatus: 'email_verified',
      hasLocalPassword: false,
    });
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].token).toBe(
      crypto.createHash('sha256').update(res.refreshToken).digest('hex'),
    );
    expect((await rowFor(email)).consumedAt).not.toBeNull();
  });

  it('stores no plaintext code, link token or IP', async () => {
    const email = emailFor();
    const { code, linkToken } = await issue(email);
    const row = JSON.stringify(await rowFor(email));
    expect(row).not.toContain(linkToken);
    expect(row).not.toContain(`"${code}"`);
    expect(row).not.toMatch(/(?<![\d.])10\.\d+\.0\.1(?![\d.])/);
  });

  it('lets exactly one of many parallel verifies with the right code succeed', async () => {
    const email = emailFor();
    const { code } = await issue(email);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        service.verify(email, code, `20.0.0.${i}`),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(1);
  });

  it('counts parallel wrong guesses exactly and stops at the maximum', async () => {
    const email = emailFor();
    const { code } = await issue(email);
    const wrong = code === '123456' ? '654321' : '123456';
    await Promise.allSettled(
      Array.from({ length: 9 }, (_, i) =>
        service.verify(email, wrong, `21.0.0.${i}`),
      ),
    );
    expect((await rowFor(email)).attempts).toBe(5);
    await expect(service.verify(email, code, '21.1.1.1')).rejects.toMatchObject(
      {
        status: 400,
      },
    );
  });

  it('lets exactly one of many parallel consumes of the same link succeed', async () => {
    const email = emailFor();
    const { linkToken } = await issue(email);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        service.consume(linkToken, `22.0.0.${i}`),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('lets exactly one of the code and the link win a race', async () => {
    const email = emailFor();
    const { code, linkToken } = await issue(email);
    const results = await Promise.allSettled([
      service.verify(email, code, '23.0.0.1'),
      service.consume(linkToken, '23.0.0.2'),
      service.verify(email, code, '23.0.0.3'),
      service.consume(linkToken, '23.0.0.4'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects a code and a link after the 10 minute expiry', async () => {
    const email = emailFor();
    const { code, linkToken } = await issue(email);
    jest.useFakeTimers({
      now: Date.now() + 601_000,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    try {
      await expect(
        service.verify(email, code, '24.0.0.1'),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.consume(linkToken, '24.0.0.1'),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps only the newest open challenge per email', async () => {
    const email = emailFor();
    const first = await issue(email);
    jest.useFakeTimers({
      now: Date.now() + 61_000,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    let second: (typeof captured)[number];
    try {
      second = await issue(email);
    } finally {
      jest.useRealTimers();
    }
    const old = await prisma.loginChallenge.findUniqueOrThrow({
      where: { id: first.challengeId },
    });
    expect(old.invalidatedAt).not.toBeNull();
    expect(second.challengeId).not.toBe(first.challengeId);
    const open = await prisma.loginChallenge.findMany({
      where: { emailNormalized: email, invalidatedAt: null, consumedAt: null },
      select: { id: true },
    });
    expect(open).toEqual([{ id: second.challengeId }]);
  });

  it('finds a mixed-case stored account without creating a duplicate', async () => {
    const stamp = `${run}-${++n}`;
    const stored = `Pwl-It-Mixed-${stamp}@Example.com`;
    const created = await prisma.user.create({
      data: { email: stored, passwordHash: 'h', isEmailVerified: true },
    });
    const lower = stored.toLowerCase();
    const { code } = await issue(lower);
    const res = await service.verify(lower, code, '25.0.0.1');
    expect(res.isNewUser).toBe(false);
    expect(res.user.id).toBe(created.id);
    expect(
      await prisma.user.count({
        where: { email: { equals: lower, mode: 'insensitive' } },
      }),
    ).toBe(1);
    await prisma.user.deleteMany({ where: { id: created.id } });
  });

  it('purges expired challenges in bounded batches', async () => {
    const repo = new PrismaLoginChallengeRepository(prisma as never);
    const email = emailFor();
    const old = new Date(Date.now() - 3 * 86_400_000);
    const cutoff = new Date(Date.now() - 86_400_000);
    await prisma.loginChallenge.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    await prisma.loginChallenge.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        emailNormalized: email,
        codeHash: 'x',
        linkTokenHash: `purge-${run}-${n}-${i}`,
        expiresAt: old,
      })),
    });
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(2);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(2);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(1);
    expect(
      await prisma.loginChallenge.count({ where: { emailNormalized: email } }),
    ).toBe(0);
  });

  it('refunds one attempt on an open challenge and none on a consumed one', async () => {
    const repo = new PrismaLoginChallengeRepository(prisma as never);
    const email = emailFor();
    await issue(email);
    const { id } = await prisma.loginChallenge.findFirstOrThrow({
      where: { emailNormalized: email },
    });
    const now = new Date();
    for (let i = 0; i < 5; i += 1) {
      expect(await repo.recordAttempt(id, now)).not.toBeNull();
    }
    expect(await repo.recordAttempt(id, now)).toBeNull();

    await repo.refundAttempt(id);

    expect(await repo.recordAttempt(id, now)).not.toBeNull();
    await repo.consumeById(id, now);
    await repo.refundAttempt(id);
    expect(
      await prisma.loginChallenge.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ attempts: 5 });
  });

  it('strips every credential an attacker planted on an unverified account and keeps the kids', async () => {
    const stamp = `${run}-${++n}`;
    const email = `pwl-it-victim-${stamp}@example.com`;
    const attacker = await prisma.user.create({
      data: {
        email,
        passwordHash: 'attacker-hash',
        isEmailVerified: false,
        googleId: `pwl-it-g-${stamp}`,
        appleId: `pwl-it-a-${stamp}`,
        pinHash: 'attacker-pin',
        biometricsEnabled: true,
        hasLocalPassword: true,
      },
    });
    await prisma.session.create({
      data: {
        userId: attacker.id,
        token: `pwl-it-sess-${stamp}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.deviceToken.create({
      data: {
        userId: attacker.id,
        token: `pwl-it-dev-${stamp}`,
        platform: 'ios',
      },
    });
    await prisma.kid.create({
      data: { parentId: attacker.id, name: 'planted' },
    });

    const { code } = await issue(email);
    const res = await service.verify(email, code, '26.0.0.1');

    expect(res.isNewUser).toBe(false);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: attacker.id },
    });
    expect(after).toMatchObject({
      isEmailVerified: true,
      googleId: null,
      appleId: null,
      pinHash: null,
      biometricsEnabled: false,
      hasLocalPassword: false,
    });
    expect(after.passwordHash).not.toBe('attacker-hash');
    expect(
      await prisma.session.count({
        where: { userId: attacker.id, token: `pwl-it-sess-${stamp}` },
      }),
    ).toBe(0);
    expect(
      await prisma.deviceToken.count({ where: { userId: attacker.id } }),
    ).toBe(0);
    expect(await prisma.kid.count({ where: { parentId: attacker.id } })).toBe(
      1,
    );
    await prisma.kid.deleteMany({ where: { parentId: attacker.id } });
  });

  it('only links a provider to a verified account', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const unverified = await prisma.user.create({
      data: {
        email: `pwl-it-u-${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: false,
      },
    });
    const verified = await prisma.user.create({
      data: {
        email: `pwl-it-v-${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: true,
      },
    });

    expect(
      await authRepo.linkGoogleAccountIfUnset(
        unverified.id,
        `pwl-it-g1-${stamp}`,
      ),
    ).toEqual({ count: 0 });
    expect(
      await authRepo.linkAppleAccountIfUnset(
        unverified.id,
        `pwl-it-a1-${stamp}`,
      ),
    ).toEqual({ count: 0 });
    expect(
      await authRepo.linkGoogleAccountIfUnset(
        verified.id,
        `pwl-it-g2-${stamp}`,
      ),
    ).toEqual({ count: 1 });
  });

  it.each([
    ['suspended', { isSuspended: true }],
    ['deleted', { isDeleted: true }],
  ])('does not link a provider to a %s account', async (_label, flag) => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const user = await prisma.user.create({
      data: {
        email: `pwl-it-in-${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: true,
        ...flag,
      },
    });

    expect(
      await authRepo.linkGoogleAccountIfUnset(user.id, `pwl-it-g-${stamp}`),
    ).toEqual({ count: 0 });
    expect(
      await authRepo.linkAppleAccountIfUnset(user.id, `pwl-it-a-${stamp}`),
    ).toEqual({ count: 0 });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ googleId: null, appleId: null });
  });

  it('refuses a link tied to a session that no longer exists', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const user = await prisma.user.create({
      data: {
        email: `pwl-it-s-${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: true,
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        token: `pwl-it-ls-${stamp}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    expect(
      await authRepo.linkGoogleAccountIfUnset(
        user.id,
        `pwl-it-g3-${stamp}`,
        'missing-session',
      ),
    ).toEqual({ count: 0 });
    expect(
      await authRepo.linkGoogleAccountIfUnset(
        user.id,
        `pwl-it-g3-${stamp}`,
        session.id,
      ),
    ).toEqual({ count: 1 });
  });

  it('refuses a link tied to a soft-revoked session', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const user = await prisma.user.create({
      data: {
        email: `pwl-it-sr-${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: true,
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        token: `pwl-it-sr-${stamp}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    expect(
      await authRepo.linkGoogleAccountIfUnset(
        user.id,
        `pwl-it-g4-${stamp}`,
        session.id,
      ),
    ).toEqual({ count: 0 });
  });

  it('never lets a link in flight during a takeover attach the attacker identity', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    for (let round = 0; round < 12; round++) {
      const stamp = `${run}-${++n}`;
      const email = `pwl-it-race-${stamp}@example.com`;
      const attacker = await prisma.user.create({
        data: { email, passwordHash: 'attacker-hash', isEmailVerified: false },
      });
      const session = await prisma.session.create({
        data: {
          userId: attacker.id,
          token: `pwl-it-rs-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const { code } = await issue(email);

      await Promise.all([
        service.verify(email, code, '27.0.0.1'),
        authRepo.linkGoogleAccountIfUnset(
          attacker.id,
          `pwl-it-atk-${stamp}`,
          session.id,
        ),
      ]);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: attacker.id },
      });
      expect(after.isEmailVerified).toBe(true);
      expect(after.googleId).toBeNull();
    }
  });

  it('makes a link that was waiting on the takeover see the revoked session', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const user = await prisma.user.create({
      data: {
        email: `pwl-it-wait-${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: false,
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        token: `pwl-it-ws-${stamp}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });

    let link: Promise<{ count: number }> = Promise.resolve({ count: -1 });
    await drainOnFailure(
      prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: { biometricsEnabled: false },
        });
        link = authRepo.linkGoogleAccountIfUnset(
          user.id,
          `pwl-it-wait-g-${stamp}`,
          session.id,
        );
        await blockedBeforeSettled(
          link,
          'SELECT "id" FROM "users"%FOR UPDATE%',
        );
      }),
      () => link,
    );

    expect(await link).toEqual({ count: 0 });
  });

  it('rolls the whole takeover back when its last statement fails', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    await prisma.user.create({
      data: {
        email: `pwl-it-dup-${stamp}@example.com`,
        passwordHash: 'h',
        googleId: `pwl-it-dup-g-${stamp}`,
      },
    });
    const victim = await prisma.user.create({
      data: {
        email: `pwl-it-rb-${stamp}@example.com`,
        passwordHash: 'attacker-hash',
        isEmailVerified: false,
        hasLocalPassword: true,
        pinHash: 'attacker-pin',
        biometricsEnabled: true,
        appleId: `pwl-it-rb-a-${stamp}`,
      },
    });
    await prisma.session.create({
      data: {
        userId: victim.id,
        token: `pwl-it-rb-s-${stamp}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.deviceToken.create({
      data: {
        userId: victim.id,
        token: `pwl-it-rb-d-${stamp}`,
        platform: 'ios',
      },
    });

    await expect(
      authRepo.takeOverUnverifiedAccount(victim, {
        passwordHash: 'rotated',
        hasLocalPassword: false,
        pinHash: null,
        biometricsEnabled: false,
        isEmailVerified: true,
        googleId: `pwl-it-dup-g-${stamp}`,
        appleId: null,
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['googleId'] },
    });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: victim.id },
    });
    expect(after).toMatchObject({
      passwordHash: 'attacker-hash',
      hasLocalPassword: true,
      pinHash: 'attacker-pin',
      biometricsEnabled: true,
      isEmailVerified: false,
      googleId: null,
      appleId: `pwl-it-rb-a-${stamp}`,
    });
    expect(await prisma.session.count({ where: { userId: victim.id } })).toBe(
      1,
    );
    expect(
      await prisma.deviceToken.count({ where: { userId: victim.id } }),
    ).toBe(1);
  });

  it('deletes reset and verification tokens the attacker requested before the takeover', async () => {
    const stamp = `${run}-${++n}`;
    const email = `pwl-it-tok-${stamp}@example.com`;
    const attacker = await prisma.user.create({
      data: { email, passwordHash: 'attacker-hash', isEmailVerified: false },
    });
    await prisma.token.createMany({
      data: ['PASSWORD_RESET', 'VERIFICATION'].map((type, i) => ({
        userId: attacker.id,
        token: `pwl-it-tok-${stamp}-${i}`,
        type,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    });

    const { code } = await issue(email);
    await service.verify(email, code, '28.0.0.1');

    expect(await prisma.token.count({ where: { userId: attacker.id } })).toBe(
      0,
    );
  });

  it('prefers a verified account, then the exact case, then the oldest for a case-insensitive lookup', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const upper = `PWL-IT-CASE-${stamp}@EXAMPLE.COM`;
    const lower = upper.toLowerCase();
    const older = await prisma.user.create({
      data: {
        email: upper,
        passwordHash: 'h',
        isEmailVerified: false,
        createdAt: new Date(Date.now() - 2000),
      },
    });
    const newer = await prisma.user.create({
      data: { email: lower, passwordHash: 'h', isEmailVerified: false },
    });
    const mixed = `Pwl-It-Case-${stamp}@Example.com`;

    expect((await authRepo.findUserByEmailInsensitive(lower))?.id).toBe(
      newer.id,
    );
    expect((await authRepo.findUserByEmailInsensitive(upper))?.id).toBe(
      older.id,
    );
    expect((await authRepo.findUserByEmailInsensitive(mixed))?.id).toBe(
      older.id,
    );

    await prisma.user.update({
      where: { id: newer.id },
      data: { isEmailVerified: true },
    });
    expect((await authRepo.findUserByEmailInsensitive(mixed))?.id).toBe(
      newer.id,
    );
    expect((await authRepo.findUserByEmailInsensitive(upper))?.id).toBe(
      newer.id,
    );
  });

  it('lands a lowercase sign-in on the verified mixed-case account, not on an attacker unverified lowercase row', async () => {
    const stamp = `${run}-${++n}`;
    const mixed = `Pwl-It-Div-${stamp}@Example.com`;
    const victim = await prisma.user.create({
      data: {
        email: mixed,
        passwordHash: 'victim-hash',
        isEmailVerified: true,
      },
    });
    const attacker = await prisma.user.create({
      data: {
        email: mixed.toLowerCase(),
        passwordHash: 'attacker-hash',
        isEmailVerified: false,
      },
    });

    const { code } = await issue(mixed.toLowerCase());
    const res = await service.verify(mixed.toLowerCase(), code, '29.0.0.1');
    expect(res.user.id).toBe(victim.id);
    expect(res.isNewUser).toBe(false);
    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: attacker.id },
    });
    expect(untouched.isEmailVerified).toBe(false);
    expect(untouched.passwordHash).toBe('attacker-hash');
  });

  it('lands an OAuth sign-in with the lowercase provider email on the verified account too', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const mixed = `Pwl-It-Oauth-${stamp}@Example.com`;
    const victim = await prisma.user.create({
      data: {
        email: mixed,
        passwordHash: 'victim-hash',
        isEmailVerified: true,
      },
    });
    const attacker = await prisma.user.create({
      data: {
        email: mixed.toLowerCase(),
        passwordHash: 'a',
        isEmailVerified: false,
      },
    });

    const result = await findOrCreateParentByVerifiedEmail(
      {
        authRepository: authRepo,
        passwordService: { hashPassword: () => Promise.resolve('x') },
      },
      {
        email: mixed.toLowerCase(),
        emailVerified: true,
        googleId: `pwl-it-oauth-g-${stamp}`,
        refuseInactive: true,
        matchEmailCaseInsensitively: true,
      },
    );

    expect(result.user.id).toBe(victim.id);
    expect(result.newlyVerified).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: attacker.id } }))
        .isEmailVerified,
    ).toBe(false);
  });

  it('still lets the emailed link sign in after the code attempts are spent', async () => {
    const email = emailFor();
    const { code, linkToken } = await issue(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await service.verify(email, wrong, `31.0.${i}.1`).catch(() => undefined);
    }
    await expect(service.verify(email, code, '31.0.9.1')).rejects.toThrow();

    await expect(service.consume(linkToken, '31.0.9.1')).resolves.toMatchObject(
      {
        isNewUser: true,
      },
    );
  });

  describe('LIKE wildcards in the sign-in email', () => {
    it('does not let an underscore in the address capture another verified account (code)', async () => {
      const stamp = `${run}-${++n}`;
      const victim = await prisma.user.create({
        data: {
          email: `pwl-it-john.smith${stamp}@example.com`,
          passwordHash: 'v',
          isEmailVerified: true,
        },
      });
      const attackerEmail = `pwl-it-john_smith${stamp}@example.com`;

      const { code } = await issue(attackerEmail);
      const res = await service.verify(attackerEmail, code, '32.0.0.1');

      expect(res.user.id).not.toBe(victim.id);
      expect(res.isNewUser).toBe(true);
    });

    it('does not let an underscore capture another verified account (link)', async () => {
      const stamp = `${run}-${++n}`;
      const victim = await prisma.user.create({
        data: {
          email: `pwl-it-link.smith${stamp}@example.com`,
          passwordHash: 'v',
          isEmailVerified: true,
        },
      });
      const attackerEmail = `pwl-it-link_smith${stamp}@example.com`;

      const { linkToken } = await issue(attackerEmail);
      const res = await service.consume(linkToken, '32.0.1.1');

      expect(res.user.id).not.toBe(victim.id);
    });

    it('does not let a percent sign convert an unverified account that is not the attacker address', async () => {
      const stamp = `${run}-${++n}`;
      const victim = await prisma.user.create({
        data: {
          email: `pwl-it-alice.unv${stamp}@example.com`,
          passwordHash: 'victim-hash',
          isEmailVerified: false,
        },
      });
      const attackerEmail = `pwl-it-alice%${stamp}@example.com`;
      const matching = await prisma.user.create({
        data: {
          email: `pwl-it-alice%${stamp}.x@example.com`,
          passwordHash: 'other',
          isEmailVerified: false,
        },
      });

      const { code } = await issue(attackerEmail);
      const res = await service.verify(attackerEmail, code, '32.0.2.1');

      expect(res.isNewUser).toBe(true);
      expect(res.user.email).toBe(attackerEmail);
      expect([victim.id, matching.id]).not.toContain(res.user.id);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: victim.id },
      });
      expect(after.isEmailVerified).toBe(false);
      expect(after.passwordHash).toBe('victim-hash');
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: matching.id } }))
          .isEmailVerified,
      ).toBe(false);
    });

    it('does not let an underscore in an OAuth email capture another account or add the attacker provider id', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const stamp = `${run}-${++n}`;
      const victim = await prisma.user.create({
        data: {
          email: `pwl-it-ann.lee${stamp}@example.com`,
          passwordHash: 'v',
          isEmailVerified: true,
        },
      });

      const result = await findOrCreateParentByVerifiedEmail(
        {
          authRepository: authRepo,
          passwordService: { hashPassword: () => Promise.resolve('x') },
        },
        {
          email: `pwl-it-ann_lee${stamp}@example.com`,
          emailVerified: true,
          appleId: `pwl-it-atk-apple-${stamp}`,
          refuseInactive: true,
          matchEmailCaseInsensitively: true,
        },
      );

      expect(result.user.id).not.toBe(victim.id);
      expect(result.isNewUser).toBe(true);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: victim.id } }))
          .appleId,
      ).toBeNull();
    });
  });

  it('prefers an exact-case verified variant over an older verified one', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const upper = `PWL-IT-OLD-${stamp}@EXAMPLE.COM`;
    await prisma.user.create({
      data: {
        email: upper.toLowerCase(),
        passwordHash: 'h',
        isEmailVerified: true,
        createdAt: new Date(Date.now() - 2000),
      },
    });
    const exact = await prisma.user.create({
      data: { email: upper, passwordHash: 'h', isEmailVerified: true },
    });

    expect((await authRepo.findUserByEmailInsensitive(upper))?.id).toBe(
      exact.id,
    );
  });

  it('refuses when several verified variants match and none is the exact case', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const base = `pwl-it-amb-${stamp}@example.com`;
    await prisma.user.create({
      data: { email: base, passwordHash: 'h', isEmailVerified: true },
    });
    await prisma.user.create({
      data: {
        email: base.toUpperCase(),
        passwordHash: 'h',
        isEmailVerified: true,
      },
    });

    await expect(
      authRepo.findUserByEmailInsensitive(`Pwl-It-Amb-${stamp}@Example.com`),
    ).rejects.toThrow(AmbiguousEmailAccountError);
  });

  it('signs an exact-case OAuth email into its own account and leaves the lowercase twin unlinked', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const lower = `pwl-it-twin-${stamp}@example.com`;
    const twin = await prisma.user.create({
      data: {
        email: lower,
        passwordHash: 'h',
        isEmailVerified: true,
        createdAt: new Date(Date.now() - 2000),
      },
    });
    const exact = await prisma.user.create({
      data: {
        email: lower.toUpperCase(),
        passwordHash: 'h',
        isEmailVerified: true,
      },
    });

    const result = await findOrCreateParentByVerifiedEmail(
      {
        authRepository: authRepo,
        passwordService: { hashPassword: () => Promise.resolve('x') },
      },
      {
        email: lower.toUpperCase(),
        emailVerified: true,
        googleId: `pwl-it-g-${stamp}`,
        matchEmailCaseInsensitively: true,
      },
    );

    expect(result.user.id).toBe(exact.id);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: twin.id } }))
        .googleId,
    ).toBeNull();
  });

  it.each([
    ['suspended', { isSuspended: true }],
    ['deleted', { isDeleted: true }],
  ])(
    'leaves an unverified %s account and its sessions untouched when a takeover is attempted',
    async (_label, flags) => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-inactive-${stamp}@example.com`,
          passwordHash: 'original',
          isEmailVerified: false,
          ...flags,
        },
      });
      await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-ia-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      await expect(
        authRepo.takeOverUnverifiedAccount(user, {
          passwordHash: 'rotated',
          isEmailVerified: true,
        }),
      ).rejects.toThrow(AccountAlreadyVerifiedError);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after).toMatchObject({
        passwordHash: 'original',
        isEmailVerified: false,
      });
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        1,
      );
    },
  );

  describe('registration session racing a takeover', () => {
    const registrant = async () => {
      const stamp = `${run}-${++n}`;
      return prisma.user.create({
        data: {
          email: `pwl-it-reg-${stamp}@example.com`,
          passwordHash: 'registrant-hash',
          isEmailVerified: false,
        },
      });
    };
    const takeOverData = {
      passwordHash: 'rotated',
      isEmailVerified: true,
    };

    it('refuses the registrant a session once the takeover has committed', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const tokens = new TokenService(
        new JwtService({ secret: 's' }),
        authRepo,
      );
      const user = await registrant();
      await authRepo.takeOverUnverifiedAccount(user, takeOverData);

      await expect(
        tokens.createTokenPair(user as never, { requireUnverified: true }),
      ).rejects.toThrow(AccountAlreadyVerifiedError);

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });

    it('never leaves a registrant session on an account the takeover verified', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const tokens = new TokenService(
        new JwtService({ secret: 's' }),
        authRepo,
      );
      for (let round = 0; round < 12; round++) {
        const user = await registrant();

        await Promise.allSettled([
          authRepo.takeOverUnverifiedAccount(user, takeOverData),
          tokens.createTokenPair(user as never, { requireUnverified: true }),
        ]);

        const after = await prisma.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        expect(after.isEmailVerified).toBe(true);
        expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
          0,
        );
      }
    });
  });

  it('lets only one of two concurrent first sign-ins for differently cased spellings of a mailbox create an account', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const lower = `pwl-it-case${stamp}@example.com`;
    const mixed = `PWL-it-Case${stamp}@example.com`;
    const signIn = (email: string) =>
      findOrCreateParentByVerifiedEmail(
        {
          authRepository: authRepo,
          passwordService: { hashPassword: () => Promise.resolve('x') },
        },
        {
          email,
          emailVerified: true,
          matchEmailCaseInsensitively: true,
        },
      );

    const results = await Promise.all([signIn(lower), signIn(mixed)]);

    expect(results.filter((r) => r.isNewUser)).toHaveLength(1);
    expect(results[0].user.id).toBe(results[1].user.id);
    expect(
      await prisma.user.count({
        where: { email: { equals: lower, mode: 'insensitive' } },
      }),
    ).toBe(1);
  });

  it('keeps an existing provider id when a verified-email match arrives with a different one', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const owner = await prisma.user.create({
      data: {
        email: `pwl-it-keep${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: true,
        googleId: `pwl-it-keep-g-${stamp}`,
        appleId: `pwl-it-keep-a-${stamp}`,
      },
    });

    await findOrCreateParentByVerifiedEmail(
      {
        authRepository: authRepo,
        passwordService: { hashPassword: () => Promise.resolve('x') },
      },
      {
        email: owner.email,
        emailVerified: true,
        googleId: `pwl-it-new-g-${stamp}`,
        appleId: `pwl-it-new-a-${stamp}`,
        matchEmailCaseInsensitively: true,
      },
    );

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(after.googleId).toBe(`pwl-it-keep-g-${stamp}`);
    expect(after.appleId).toBe(`pwl-it-keep-a-${stamp}`);
  });

  it('keeps a provider id linked between the lookup and the sign-in write', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const owner = await prisma.user.create({
      data: {
        email: `pwl-it-race${stamp}@example.com`,
        passwordHash: 'h',
        isEmailVerified: true,
      },
    });
    const racingRepo = Object.create(authRepo) as PrismaAuthRepository;
    racingRepo.findUserByEmailInsensitive = async (email: string) => {
      const snapshot = await authRepo.findUserByEmailInsensitive(email);
      await authRepo.linkGoogleAccountIfUnset(
        owner.id,
        `pwl-it-first-${stamp}`,
      );
      return snapshot;
    };

    const result = await findOrCreateParentByVerifiedEmail(
      {
        authRepository: racingRepo,
        passwordService: { hashPassword: () => Promise.resolve('x') },
      },
      {
        email: owner.email,
        emailVerified: true,
        googleId: `pwl-it-second-${stamp}`,
        matchEmailCaseInsensitively: true,
      },
    );

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(after.googleId).toBe(`pwl-it-first-${stamp}`);
    expect(result.user.googleId).toBe(`pwl-it-first-${stamp}`);
  });

  it('refuses to reset an account that was verified between the read and the takeover', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${run}-${++n}`;
    const unverifiedSnapshot = await prisma.user.create({
      data: {
        email: `pwl-it-late${stamp}@example.com`,
        passwordHash: 'owner-hash',
        isEmailVerified: false,
        pinHash: 'owner-pin',
      },
    });
    const user = await prisma.user.update({
      where: { id: unverifiedSnapshot.id },
      data: { isEmailVerified: true },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        token: `pwl-it-late-s-${stamp}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await expect(
      authRepo.takeOverUnverifiedAccount(unverifiedSnapshot, {
        passwordHash: 'rotated',
        hasLocalPassword: false,
        pinHash: null,
        biometricsEnabled: false,
        isEmailVerified: true,
        googleId: null,
        appleId: null,
      }),
    ).rejects.toBeInstanceOf(AccountAlreadyVerifiedError);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.passwordHash).toBe('owner-hash');
    expect(after.pinHash).toBe('owner-pin');
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  describe('takeover of an account whose email changed after the lookup', () => {
    const seedRenamable = async () => {
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-mv-${stamp}@example.com`,
          passwordHash: 'attacker-hash',
          isEmailVerified: false,
        },
      });
      await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-mv-s-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      return { user, renamed: `pwl-it-mv-renamed-${stamp}@example.com` };
    };
    const expectUntouched = async (id: string) => {
      const after = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(after.isEmailVerified).toBe(false);
      expect(after.passwordHash).toBe('attacker-hash');
      expect(await prisma.session.count({ where: { userId: id } })).toBe(1);
    };

    it('refuses the takeover and leaves the account untouched', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, renamed } = await seedRenamable();
      await prisma.user.update({
        where: { id: user.id },
        data: { email: renamed },
      });

      await expect(
        authRepo.takeOverUnverifiedAccount(user, {
          passwordHash: 'rotated',
          isEmailVerified: true,
        }),
      ).rejects.toBeInstanceOf(TakeoverTargetChangedError);
      await expectUntouched(user.id);
    });

    it('reports the changed email, not a verified account, when the rename also verified it', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, renamed } = await seedRenamable();
      await prisma.user.update({
        where: { id: user.id },
        data: { email: renamed, isEmailVerified: true },
      });

      await expect(
        authRepo.takeOverUnverifiedAccount(user, {
          passwordHash: 'rotated',
          isEmailVerified: true,
        }),
      ).rejects.toBeInstanceOf(TakeoverTargetChangedError);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        1,
      );
    });

    it('refuses the takeover when the rename commits while the takeover waits on the row', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, renamed } = await seedRenamable();
      let takeover: Promise<unknown> = Promise.resolve();

      await drainOnFailure(
        prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { email: renamed },
          });
          takeover = authRepo
            .takeOverUnverifiedAccount(user, {
              passwordHash: 'rotated',
              isEmailVerified: true,
            })
            .catch((error: unknown) => error);
          await blockedBeforeSettled(takeover, '%FOR NO KEY UPDATE%');
        }),
        () => takeover,
      );

      expect(await takeover).toBeInstanceOf(TakeoverTargetChangedError);
      await expectUntouched(user.id);
    });

    it('accepts the proven email in another case', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user } = await seedRenamable();

      await authRepo.takeOverUnverifiedAccount(
        { id: user.id, email: user.email.toUpperCase() },
        { passwordHash: 'rotated', isEmailVerified: true },
      );

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.isEmailVerified).toBe(true);
    });
  });

  describe('change-password in flight during a takeover', () => {
    const makePasswordService = (authRepo: PrismaAuthRepository) =>
      new PasswordService(authRepo, new EventEmitter2(), {} as never);

    const seedAttacker = async (label: string) => {
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-${label}-${stamp}@example.com`,
          passwordHash: await bcrypt.hash('AttackerOld1#', 4),
          isEmailVerified: false,
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-${label}-s-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      return { user, session };
    };

    it('does not let a change-password that read before the takeover write the attacker password after it', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const passwords = makePasswordService(authRepo);
      const { user, session } = await seedAttacker('cpw');

      let change: Promise<unknown> = Promise.resolve();
      await drainOnFailure(
        prisma.$transaction(async (tx) => {
          await tx.session.deleteMany({ where: { userId: user.id } });
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash: 'victim-owned-hash', isEmailVerified: true },
          });
          change = passwords
            .changePassword(
              user.id,
              { oldPassword: 'AttackerOld1#', newPassword: 'AttackerNew1#' },
              session.id,
            )
            .catch((error: unknown) => error);
          await blockedBeforeSettled(change, 'UPDATE%"users"%');
        }),
        () => change,
      );
      const outcome = await change;

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.passwordHash).toBe('victim-owned-hash');
      expect(outcome).toBeInstanceOf(UnauthorizedException);
    });

    const rotate = {
      passwordHash: 'rotated',
      hasLocalPassword: false,
      pinHash: null,
      biometricsEnabled: false,
      isEmailVerified: true,
      googleId: null,
      appleId: null,
    };
    const changeFor = (
      passwords: PasswordService,
      user: { id: string },
      session: { id: string },
    ) =>
      passwords
        .changePassword(
          user.id,
          { oldPassword: 'AttackerOld1#', newPassword: 'AttackerNew1#' },
          session.id,
        )
        .catch((error: unknown) => error);

    it('lets a takeover wait out a change-password that already holds the user row', async () => {
      const gated = gateTransactionStep('session', 'deleteMany');
      const passwords = makePasswordService(
        new PrismaAuthRepository(gated.client as never),
      );
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, session } = await seedAttacker('cpd1');

      const change = changeFor(passwords, user, session);
      await untilReached(gated.reached, change, gated.release);
      const takeover = authRepo
        .takeOverUnverifiedAccount(user, rotate)
        .catch((error: unknown) => error);
      await releaseAfter(
        waitForBlockedStatement('%FOR NO KEY UPDATE%'),
        gated.release,
        [change, takeover],
      );
      const [changed, taken] = await Promise.all([change, takeover]);

      expect(changed).not.toBeInstanceOf(Error);
      expect(taken).not.toBeInstanceOf(Error);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.passwordHash).toBe('rotated');
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });

    it('refuses a change-password that read the old hash and then waited on a running takeover', async () => {
      const gated = gateTransactionStep('token', 'deleteMany');
      const authRepo = new PrismaAuthRepository(gated.client as never);
      const passwords = makePasswordService(
        new PrismaAuthRepository(prisma as never),
      );
      const { user, session } = await seedAttacker('cpd2');

      const takeover = authRepo
        .takeOverUnverifiedAccount(user, rotate)
        .catch((error: unknown) => error);
      await untilReached(gated.reached, takeover, gated.release);
      const change = changeFor(passwords, user, session);
      await releaseAfter(
        waitForBlockedStatement('UPDATE%"users"%'),
        gated.release,
        [takeover, change],
      );
      const [taken, changed] = await Promise.all([takeover, change]);

      expect(taken).not.toBeInstanceOf(Error);
      expect(changed).toBeInstanceOf(UnauthorizedException);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.passwordHash).toBe('rotated');
    });

    it('rejects the old password once a takeover has committed', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const passwords = makePasswordService(authRepo);
      const { user, session } = await seedAttacker('cpd3');
      await authRepo.takeOverUnverifiedAccount(user, rotate);

      const changed = await changeFor(passwords, user, session);

      expect(changed).toBeInstanceOf(BadRequestException);
      expect((changed as BadRequestException).message).toBe(
        'Invalid old password',
      );
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.passwordHash).toBe('rotated');
    });

    it('still changes the password when nothing intervened', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const passwords = makePasswordService(authRepo);
      const { user, session } = await seedAttacker('cpwok');

      await passwords.changePassword(
        user.id,
        { oldPassword: 'AttackerOld1#', newPassword: 'AttackerNew1#' },
        session.id,
      );

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(await bcrypt.compare('AttackerNew1#', after.passwordHash)).toBe(
        true,
      );
    });

    it('refuses when the caller session was revoked even though the hash is unchanged', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const passwords = makePasswordService(authRepo);
      const { user, session } = await seedAttacker('cpws');
      await prisma.session.delete({ where: { id: session.id } });

      await expect(
        passwords.changePassword(
          user.id,
          { oldPassword: 'AttackerOld1#', newPassword: 'AttackerNew1#' },
          session.id,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(await bcrypt.compare('AttackerOld1#', after.passwordHash)).toBe(
        true,
      );
    });
  });
  describe('device-token registration racing a takeover', () => {
    class GatedDeviceTokenRepository extends PrismaDeviceTokenRepository {
      reachedCreate: () => void = () => undefined;
      gate: Promise<void> = Promise.resolve();

      async createToken(
        ...args: Parameters<PrismaDeviceTokenRepository['createToken']>
      ) {
        this.reachedCreate();
        await this.gate;
        return super.createToken(...args);
      }
    }

    const takeoverData = {
      passwordHash: 'rotated',
      hasLocalPassword: false,
      pinHash: null,
      biometricsEnabled: false,
      isEmailVerified: true,
      googleId: null,
      appleId: null,
    };

    const seedSquatter = async (label: string) => {
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-${label}-${stamp}@example.com`,
          passwordHash: 'squatter-hash',
          isEmailVerified: false,
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-${label}-s-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.deviceToken.create({
        data: {
          userId: user.id,
          token: `pwl-it-${label}-old-${stamp}`,
          platform: 'android',
          deviceName: 'phone',
        },
      });
      return { user, session, stamp };
    };

    it('does not deadlock when a token registration holds the old device rows while the takeover runs', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const tokenRepo = new GatedDeviceTokenRepository(prisma as never);
      const devices = new DeviceTokenService(tokenRepo);
      const { user, session, stamp } = await seedSquatter('dl');

      let release: () => void = () => undefined;
      tokenRepo.gate = new Promise<void>((resolve) => (release = resolve));
      const reached = new Promise<void>(
        (resolve) => (tokenRepo.reachedCreate = resolve),
      );
      const register = devices
        .registerDeviceToken(
          user.id,
          {
            token: `pwl-it-dl-new-${stamp}`,
            platform: 'android',
            deviceName: 'phone',
          },
          session.id,
        )
        .catch((error: unknown) => error);
      await untilReached(reached, register, release);

      const takeover = authRepo
        .takeOverUnverifiedAccount(user, takeoverData)
        .catch((error: unknown) => error);
      await releaseAfter(
        waitForBlockedStatement('DELETE%"sessions"%'),
        release,
        [register, takeover],
      );
      const [registered, taken] = await Promise.all([register, takeover]);

      expect(taken).not.toBeInstanceOf(Error);
      expect(registered).not.toBeInstanceOf(Error);
    });
    it('leaves no device token on the account when a registration was in flight during the takeover', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const tokenRepo = new GatedDeviceTokenRepository(prisma as never);
      const devices = new DeviceTokenService(tokenRepo);
      const { user, session, stamp } = await seedSquatter('surv');
      await prisma.deviceToken.deleteMany({ where: { userId: user.id } });

      let release: () => void = () => undefined;
      tokenRepo.gate = new Promise<void>((resolve) => (release = resolve));
      const reached = new Promise<void>(
        (resolve) => (tokenRepo.reachedCreate = resolve),
      );
      const register = devices
        .registerDeviceToken(
          user.id,
          { token: `pwl-it-surv-new-${stamp}`, platform: 'android' },
          session.id,
        )
        .catch((error: unknown) => error);
      await untilReached(reached, register, release);

      const takeover = authRepo
        .takeOverUnverifiedAccount(user, takeoverData)
        .catch((error: unknown) => error);
      await releaseAfter(
        blockedBeforeSettled(takeover, 'DELETE%"sessions"%'),
        release,
        [register, takeover],
      );
      const [, taken] = await Promise.all([register, takeover]);

      expect(taken).not.toBeInstanceOf(Error);
      expect(
        await prisma.deviceToken.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it('does not deadlock an admin hard delete against a registration in flight', async () => {
      const adminRepo = new PrismaAdminUserRepository(prisma as never);
      const tokenRepo = new GatedDeviceTokenRepository(prisma as never);
      const devices = new DeviceTokenService(tokenRepo);
      const { user, session, stamp } = await seedSquatter('adel');
      await prisma.deviceToken.deleteMany({ where: { userId: user.id } });

      let release: () => void = () => undefined;
      tokenRepo.gate = new Promise<void>((resolve) => (release = resolve));
      const reached = new Promise<void>(
        (resolve) => (tokenRepo.reachedCreate = resolve),
      );
      const register = devices
        .registerDeviceToken(
          user.id,
          { token: `pwl-it-adel-new-${stamp}`, platform: 'android' },
          session.id,
        )
        .catch((error: unknown) => error);
      await untilReached(reached, register, release);

      const removal = adminRepo
        .hardDeleteUser(user.id)
        .catch((error: unknown) => error);
      await releaseAfter(waitForBlockedStatement('DELETE%'), release, [
        register,
        removal,
      ]);
      const [registered, removed] = await Promise.all([register, removal]);

      expect(registered).not.toBeInstanceOf(Error);
      expect(removed).not.toBeInstanceOf(Error);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    });

    it('refuses a registration that presents another user’s session', async () => {
      const devices = new DeviceTokenService(
        new PrismaDeviceTokenRepository(prisma as never),
      );
      const owner = await seedSquatter('own');
      const other = await seedSquatter('oth');

      await expect(
        devices.registerDeviceToken(
          other.user.id,
          { token: `pwl-it-oth-new-${other.stamp}`, platform: 'android' },
          owner.session.id,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        await prisma.deviceToken.count({
          where: { token: `pwl-it-oth-new-${other.stamp}` },
        }),
      ).toBe(0);
    });

    it('does not deadlock an admin hard delete that already removed the sessions against a takeover', async () => {
      const gated = gateTransactionStep('user', 'delete');
      const adminRepo = new PrismaAdminUserRepository(gated.client as never);
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user } = await seedSquatter('adtk');

      const removal = adminRepo
        .hardDeleteUser(user.id)
        .catch((error: unknown) => error);
      await untilReached(gated.reached, removal, gated.release);
      const takeover = authRepo
        .takeOverUnverifiedAccount(user, takeoverData)
        .catch((error: unknown) => error);
      await releaseAfter(waitForBlockedStatement('%'), gated.release, [
        removal,
        takeover,
      ]);
      const [removed, taken] = await Promise.all([removal, takeover]);

      expect(removed).not.toBeInstanceOf(Error);
      expect(taken).toBeInstanceOf(TakeoverTargetChangedError);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    });

    it('lets an admin hard delete wait out a takeover that is already running', async () => {
      const gated = gateTransactionStep('token', 'deleteMany');
      const authRepo = new PrismaAuthRepository(gated.client as never);
      const adminRepo = new PrismaAdminUserRepository(prisma as never);
      const { user } = await seedSquatter('tkad');

      const takeover = authRepo
        .takeOverUnverifiedAccount(user, takeoverData)
        .catch((error: unknown) => error);
      await untilReached(gated.reached, takeover, gated.release);
      const removal = adminRepo
        .hardDeleteUser(user.id)
        .catch((error: unknown) => error);
      await releaseAfter(waitForBlockedStatement('%'), gated.release, [
        takeover,
        removal,
      ]);
      const [taken, removed] = await Promise.all([takeover, removal]);

      expect(taken).not.toBeInstanceOf(Error);
      expect(removed).not.toBeInstanceOf(Error);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    });

    const seedLinkedSquatter = async (label: string) => {
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-${label}-${stamp}@example.com`,
          passwordHash: 'squatter-hash',
          hasLocalPassword: true,
          googleId: `pwl-it-${label}-squatter-g-${stamp}`,
          isEmailVerified: false,
        },
      });
      await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-${label}-s-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      return { user, ownerGoogleId: `pwl-it-${label}-owner-g-${stamp}` };
    };

    it('keeps the provider the owner links in a takeover when an unlink read before it', async () => {
      const gated = gateTransactionStep('user', 'update');
      const linking = new AccountLinkingService(
        new PrismaAuthRepository(gated.client as never),
        { get: () => undefined } as never,
      );
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, ownerGoogleId } = await seedLinkedSquatter('unl1');

      const unlink = linking
        .unlinkProvider(user.id, 'google')
        .catch((error: unknown) => error);
      await untilReached(gated.reached, unlink, gated.release);
      const takeover = authRepo
        .takeOverUnverifiedAccount(user, {
          ...takeoverData,
          googleId: ownerGoogleId,
        })
        .catch((error: unknown) => error);
      await releaseAfter(blockedBeforeSettled(takeover, '%'), gated.release, [
        unlink,
        takeover,
      ]);
      const [unlinked, taken] = await Promise.all([unlink, takeover]);

      expect(unlinked).not.toBeInstanceOf(Error);
      expect(taken).not.toBeInstanceOf(Error);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.googleId).toBe(ownerGoogleId);
    });

    it('refuses an unlink that waited on a takeover and then sees a single sign-in method', async () => {
      const gated = gateTransactionStep('token', 'deleteMany');
      const authRepo = new PrismaAuthRepository(gated.client as never);
      const linking = new AccountLinkingService(
        new PrismaAuthRepository(prisma as never),
        { get: () => undefined } as never,
      );
      const { user, ownerGoogleId } = await seedLinkedSquatter('unl2');

      const takeover = authRepo
        .takeOverUnverifiedAccount(user, {
          ...takeoverData,
          googleId: ownerGoogleId,
        })
        .catch((error: unknown) => error);
      await untilReached(gated.reached, takeover, gated.release);
      const unlink = linking
        .unlinkProvider(user.id, 'google')
        .catch((error: unknown) => error);
      await releaseAfter(blockedBeforeSettled(unlink, '%'), gated.release, [
        takeover,
        unlink,
      ]);
      const [taken, unlinked] = await Promise.all([takeover, unlink]);

      expect(taken).not.toBeInstanceOf(Error);
      expect(unlinked).toBeInstanceOf(BadRequestException);
      expect((unlinked as BadRequestException).message).toBe(
        'Cannot unlink. You must have at least one linked sign-in method.',
      );
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.googleId).toBe(ownerGoogleId);
    });

    it('refuses a registration whose session the takeover already revoked', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const devices = new DeviceTokenService(
        new PrismaDeviceTokenRepository(prisma as never),
      );
      const { user, session, stamp } = await seedSquatter('late');
      await authRepo.takeOverUnverifiedAccount(user, takeoverData);

      await expect(
        devices.registerDeviceToken(
          user.id,
          { token: `pwl-it-late-new-${stamp}`, platform: 'android' },
          session.id,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        await prisma.deviceToken.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
  });

  describe('concurrent challenge replacement', () => {
    it('leaves exactly one open challenge per email when requests race', async () => {
      const challenges = new PrismaLoginChallengeRepository(prisma as never);
      for (let round = 0; round < 6; round++) {
        const email = `pwl-it-race-ch-${run}-${++n}@example.com`;

        await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            challenges.replaceOpenChallenge({
              id: crypto.randomUUID(),
              emailNormalized: email,
              codeHash: `c${i}`,
              linkTokenHash: crypto.randomUUID(),
              expiresAt: new Date(Date.now() + 600_000),
              requestIpHash: null,
              now: new Date(),
            }),
          ),
        );

        expect(
          await prisma.loginChallenge.count({
            where: {
              emailNormalized: email,
              consumedAt: null,
              invalidatedAt: null,
            },
          }),
        ).toBe(1);
      }
    });
  });

  describe('password change and session state', () => {
    it('changes the password for a live session', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-pwl-${stamp}@example.com`,
          passwordHash: 'old',
          isEmailVerified: true,
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-pwl-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const changed = await authRepo.transaction((tx) =>
        tx.changePasswordIfUnchanged(user.id, 'old', 'new', session.id),
      );

      expect(changed).toBe(true);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .passwordHash,
      ).toBe('new');
    });

    it('refuses a password change tied to a soft-revoked session', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-pw-${stamp}@example.com`,
          passwordHash: 'old',
          isEmailVerified: true,
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-pw-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      const changed = await authRepo.transaction((tx) =>
        tx.changePasswordIfUnchanged(user.id, 'old', 'new', session.id),
      );

      expect(changed).toBe(false);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .passwordHash,
      ).toBe('old');
    });
  });

  describe('session creation and takeover on the same user row', () => {
    const unverifiedUser = async () =>
      prisma.user.create({
        data: {
          email: `pwl-it-lk-${run}-${++n}@example.com`,
          passwordHash: 'registrant',
          isEmailVerified: false,
        },
      });
    const sessionData = (userId: string) => ({
      userId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    it('refuses a session paused behind a takeover that then commits', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const user = await unverifiedUser();
      let create: Promise<unknown> = Promise.resolve();

      await drainOnFailure(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id} FOR NO KEY UPDATE`;
          create = authRepo
            .createSessionForUnverifiedUser(sessionData(user.id))
            .then(
              () => null,
              (e: unknown) => e,
            );
          await blockedBeforeSettled(create, '%FOR SHARE%');
          await tx.session.deleteMany({ where: { userId: user.id } });
          await tx.user.update({
            where: { id: user.id },
            data: { isEmailVerified: true },
          });
        }),
        () => create,
      );

      expect(await create).toBeInstanceOf(AccountAlreadyVerifiedError);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });

    it('revokes a session inserted while the takeover was waiting on the lock', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const user = await unverifiedUser();
      let takeover: Promise<unknown> = Promise.resolve();

      await drainOnFailure(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id} FOR SHARE`;
          takeover = authRepo.takeOverUnverifiedAccount(user, {
            passwordHash: 'rotated',
            isEmailVerified: true,
          });
          await blockedBeforeSettled(takeover, '%FOR NO KEY UPDATE%');
          await tx.session.create({ data: sessionData(user.id) });
        }),
        () => takeover,
      );
      await takeover;

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });
  });

  describe('verified account renamed during sign-in', () => {
    const verifiedUser = async () => {
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-bd-${stamp}@example.com`,
          passwordHash: 'owner-hash',
          isEmailVerified: true,
        },
      });
      return { user, renamed: `pwl-it-bd-renamed-${stamp}@example.com` };
    };

    it('refuses a session paused behind an email change that then commits', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, renamed } = await verifiedUser();
      let create: Promise<unknown> = Promise.resolve();

      await drainOnFailure(
        prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { email: renamed },
          });
          create = authRepo
            .createSessionForEmail(
              {
                userId: user.id,
                token: crypto.randomUUID(),
                expiresAt: new Date(Date.now() + 3_600_000),
              },
              user.email.toUpperCase(),
            )
            .then(
              () => null,
              (e: unknown) => e,
            );
          await blockedBeforeSettled(create, '%FOR SHARE%');
        }),
        () => create,
      );

      expect(await create).toBeInstanceOf(TakeoverTargetChangedError);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });

    it('does not link a provider to the account once its email moved', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, renamed } = await verifiedUser();
      await prisma.user.update({
        where: { id: user.id },
        data: { email: renamed },
      });

      await expect(
        authRepo.linkGoogleAccountIfUnset(
          user.id,
          `pwl-it-bd-g-${run}-${n}`,
          undefined,
          user.email,
        ),
      ).resolves.toEqual({ count: 0 });

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .googleId,
      ).toBeNull();
    });

    it('signs the code holder into a fresh account, not the renamed one', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const { user, renamed } = await verifiedUser();
      const racingRepo = Object.create(authRepo) as PrismaAuthRepository;
      let moved = false;
      racingRepo.findUserByIdWithProfile = async (id: string) => {
        if (!moved && id === user.id) {
          moved = true;
          await prisma.user.update({
            where: { id: user.id },
            data: { email: renamed },
          });
        }
        return authRepo.findUserByIdWithProfile(id);
      };
      const events = new EventEmitter2();
      const codes: string[] = [];
      events.on('passwordless.requested', (p: { code: string }) =>
        codes.push(p.code),
      );
      const racing = new PasswordlessService(
        {
          get: (k: string) => ({ PASSWORDLESS_PEPPER: 'p'.repeat(40) })[k],
        } as never,
        new PrismaLoginChallengeRepository(prisma as never),
        new PasswordlessThrottleService(new InMemoryRedis() as never),
        racingRepo,
        new TokenService(new JwtService({ secret: 's' }), racingRepo),
        { hashPassword: () => Promise.resolve('hashed-random') } as never,
        events,
        { carryOver: () => Promise.resolve() } as never,
      );
      await racing.request(user.email, '10.9.9.9');

      const res = await racing.verify(user.email, codes[0], '10.9.9.9');

      expect(res.user.id).not.toBe(user.id);
      expect(res.user.email).toBe(user.email);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });
  });

  describe('account suspended or deleted during sign-in', () => {
    const activeUser = async (isEmailVerified: boolean) =>
      prisma.user.create({
        data: {
          email: `pwl-it-st-${run}-${++n}@example.com`,
          passwordHash: 'owner-hash',
          isEmailVerified,
        },
      });
    const sessionData = (userId: string) => ({
      userId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const flags = [
      ['isSuspended', { isSuspended: true, suspendedAt: new Date() }],
      ['isDeleted', { isDeleted: true, deletedAt: new Date() }],
    ] as const;

    it.each(flags)(
      'refuses an email-bound session paused behind a change to %s that then commits',
      async (_flag, change) => {
        const authRepo = new PrismaAuthRepository(prisma as never);
        const user = await activeUser(true);
        let create: Promise<unknown> = Promise.resolve();

        await drainOnFailure(
          prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id: user.id }, data: change });
            create = authRepo
              .createSessionForEmail(sessionData(user.id), user.email)
              .then(
                () => null,
                (e: unknown) => e,
              );
            await blockedBeforeSettled(create, '%FOR SHARE%');
          }),
          () => create,
        );

        expect(await create).toBeInstanceOf(InactiveAccountError);
        expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
          0,
        );
      },
    );

    it.each(flags)(
      'refuses a registration session for an account whose %s flag is set',
      async (_flag, change) => {
        const authRepo = new PrismaAuthRepository(prisma as never);
        const user = await activeUser(false);
        await prisma.user.update({ where: { id: user.id }, data: change });

        await expect(
          authRepo.createSessionForUnverifiedUser(sessionData(user.id)),
        ).rejects.toBeInstanceOf(InactiveAccountError);
        expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
          0,
        );
      },
    );

    it('answers a code for an account suspended after its status check with the generic error and no session', async () => {
      const authRepo = new PrismaAuthRepository(prisma as never);
      const user = await activeUser(true);
      const racingRepo = Object.create(authRepo) as PrismaAuthRepository;
      racingRepo.countKidsByParentId = async (id: string) => {
        await prisma.user.update({
          where: { id },
          data: { isSuspended: true, suspendedAt: new Date() },
        });
        return authRepo.countKidsByParentId(id);
      };
      const events = new EventEmitter2();
      const codes: string[] = [];
      events.on('passwordless.requested', (p: { code: string }) =>
        codes.push(p.code),
      );
      const racing = new PasswordlessService(
        {
          get: (k: string) => ({ PASSWORDLESS_PEPPER: 'p'.repeat(40) })[k],
        } as never,
        new PrismaLoginChallengeRepository(prisma as never),
        new PasswordlessThrottleService(new InMemoryRedis() as never),
        racingRepo,
        new TokenService(new JwtService({ secret: 's' }), racingRepo),
        { hashPassword: () => Promise.resolve('hashed-random') } as never,
        events,
        { carryOver: () => Promise.resolve() } as never,
      );
      await racing.request(user.email, '10.9.9.8');

      const outcome = await racing
        .verify(user.email, codes[0], '10.9.9.8')
        .catch((error: unknown) => error);

      expect(outcome).toBeInstanceOf(BadRequestException);
      expect((outcome as BadRequestException).message).toBe(
        'Invalid or expired code',
      );
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
    });
  });

  describe('device-token live-session lock', () => {
    it('blocks a soft revocation of the session until the registering transaction ends', async () => {
      const repo = new PrismaDeviceTokenRepository(prisma as never);
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-dt-${stamp}@example.com`,
          passwordHash: 'h',
          isEmailVerified: true,
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: `pwl-it-dt-${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      let revoke: Promise<unknown> = Promise.resolve();

      await drainOnFailure(
        prisma.$transaction(async (tx) => {
          expect(await repo.lockLiveSession(session.id, user.id, tx)).toBe(
            true,
          );
          revoke = prisma.session
            .updateMany({
              where: { userId: user.id },
              data: { isDeleted: true, deletedAt: new Date() },
            })
            .then((result) => result);
          await blockedBeforeSettled(revoke, '%UPDATE%sessions%', 3_000);
        }),
        () => revoke,
      );
      await revoke;

      expect(
        (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
          .isDeleted,
      ).toBe(true);
    });
  });

  describe('guest carry-over resume', () => {
    it('keeps newer progress and a deletion when the carry-over is resumed', async () => {
      const guests = new PrismaGuestRepository(prisma as never);
      const stamp = `${run}-${++n}`;
      const user = await prisma.user.create({
        data: {
          email: `pwl-it-gm-${stamp}@example.com`,
          passwordHash: 'h',
          isEmailVerified: true,
        },
      });
      const story = (suffix: string) =>
        prisma.story.create({
          data: {
            title: `pwl-it-${stamp}-${suffix}`,
            description: 'd',
            language: 'en',
            coverImageUrl: 'c',
            audioUrl: 'a',
            isInteractive: false,
            ageMin: 1,
            ageMax: 9,
          },
        });
      const storyIds: string[] = [];
      try {
        const read = await story('read');
        storyIds.push(read.id);
        const removed = await story('removed');
        storyIds.push(removed.id);
        await guests.createUserStoryProgressIfAbsent(user.id, read.id);
        await guests.createUserStoryProgressIfAbsent(user.id, removed.id);
        await prisma.userStoryProgress.update({
          where: { userId_storyId: { userId: user.id, storyId: read.id } },
          data: { progress: 70 },
        });
        await prisma.userStoryProgress.update({
          where: { userId_storyId: { userId: user.id, storyId: removed.id } },
          data: { isDeleted: true, deletedAt: new Date() },
        });

        await guests.createUserStoryProgressIfAbsent(user.id, read.id);
        await guests.createUserStoryProgressIfAbsent(user.id, removed.id);

        const rows = await prisma.userStoryProgress.findMany({
          where: { userId: user.id },
        });
        expect(rows.find((r) => r.storyId === read.id)?.progress).toBe(70);
        expect(rows.find((r) => r.storyId === removed.id)?.isDeleted).toBe(
          true,
        );
      } finally {
        await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
      }
    });
  });
});
