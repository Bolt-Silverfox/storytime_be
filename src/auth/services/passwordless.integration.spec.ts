import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PasswordlessService } from './passwordless.service';
import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { TokenService } from './token.service';
import { PrismaAuthRepository } from '../repositories/prisma-auth.repository';
import { PrismaLoginChallengeRepository } from '../repositories/prisma-login-challenge.repository';
import { InMemoryRedis } from '@/shared/testing/passwordless-fakes';

const url = process.env.PASSWORDLESS_TEST_DATABASE_URL;
const maybe = url && /throwaway|_test/.test(url) ? describe : describe.skip;

maybe('PasswordlessService against Postgres', () => {
  let prisma: PrismaClient;
  const captured: Array<{ code: string; linkToken: string }> = [];
  let service: PasswordlessService;
  let n = 0;

  const emailFor = () => `pwl-it-${process.pid}-${++n}@example.com`;
  const issue = async (email: string) => {
    await service.request(email, `10.${n % 250}.0.1`);
    return captured[captured.length - 1];
  };
  const rowFor = (email: string) =>
    prisma.loginChallenge.findFirstOrThrow({
      where: { emailNormalized: email },
      orderBy: { createdAt: 'desc' },
    });

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const events = new EventEmitter2();
    events.on('passwordless.requested', (p) => captured.push(p));
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
    await prisma.loginChallenge.deleteMany({
      where: { emailNormalized: { startsWith: 'pwl-it-' } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'pwl-it-' } },
    });
    await prisma.$disconnect();
  });

  it('has the login_challenges table with the unique link hash index', async () => {
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'login_challenges'`;
    expect(idx.map((i) => i.indexname).sort()).toEqual([
      'login_challenges_emailNormalized_createdAt_idx',
      'login_challenges_expiresAt_idx',
      'login_challenges_linkTokenHash_key',
      'login_challenges_pkey',
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
    expect(row).not.toContain('10.');
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
    await issue(email);
    const first = await rowFor(email);
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
    try {
      await issue(email);
    } finally {
      jest.useRealTimers();
    }
    const old = await prisma.loginChallenge.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(old.invalidatedAt).not.toBeNull();
  });

  it('finds a mixed-case stored account without creating a duplicate', async () => {
    const stamp = `${process.pid}-${++n}`;
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
    await prisma.loginChallenge.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        emailNormalized: email,
        codeHash: 'x',
        linkTokenHash: `purge-${process.pid}-${n}-${i}`,
        expiresAt: old,
      })),
    });
    const cutoff = new Date(Date.now() - 86_400_000);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(2);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(2);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.loginChallenge.count({ where: { emailNormalized: email } }),
    ).toBe(0);
  });

  it('strips every credential an attacker planted on an unverified account and keeps the kids', async () => {
    const stamp = `${process.pid}-${++n}`;
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
    const stamp = `${process.pid}-${++n}`;
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
});
