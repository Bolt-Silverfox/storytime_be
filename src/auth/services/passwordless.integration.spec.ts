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
import { isThrowawayDatabaseUrl } from '@/shared/testing/throwaway-database';
import { findOrCreateParentByVerifiedEmail } from './verified-email-user';

const url = process.env.PASSWORDLESS_TEST_DATABASE_URL;
const maybe = isThrowawayDatabaseUrl(url) ? describe : describe.skip;

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
      where: {
        emailNormalized: { startsWith: 'pwl-it-', mode: 'insensitive' },
      },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'pwl-it-', mode: 'insensitive' } },
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
    const cutoff = new Date(Date.now() - 86_400_000);
    await prisma.loginChallenge.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    await prisma.loginChallenge.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        emailNormalized: email,
        codeHash: 'x',
        linkTokenHash: `purge-${process.pid}-${n}-${i}`,
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

  it('refuses a link tied to a session that no longer exists', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${process.pid}-${++n}`;
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

  it('never lets a link in flight during a takeover attach the attacker identity', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    for (let round = 0; round < 12; round++) {
      const stamp = `${process.pid}-${++n}`;
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
    const stamp = `${process.pid}-${++n}`;
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
    await prisma.$transaction(async (tx) => {
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
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(await link).toEqual({ count: 0 });
  });

  it('rolls the whole takeover back when its last statement fails', async () => {
    const authRepo = new PrismaAuthRepository(prisma as never);
    const stamp = `${process.pid}-${++n}`;
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
      authRepo.takeOverUnverifiedAccount(victim.id, {
        passwordHash: 'rotated',
        hasLocalPassword: false,
        pinHash: null,
        biometricsEnabled: false,
        isEmailVerified: true,
        googleId: `pwl-it-dup-g-${stamp}`,
        appleId: null,
      }),
    ).rejects.toThrow();

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
    const stamp = `${process.pid}-${++n}`;
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
    const stamp = `${process.pid}-${++n}`;
    const upper = `PWL-IT-CASE-${stamp}@EXAMPLE.COM`;
    const lower = upper.toLowerCase();
    const older = await prisma.user.create({
      data: { email: upper, passwordHash: 'h', isEmailVerified: false },
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
    const stamp = `${process.pid}-${++n}`;
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
    const stamp = `${process.pid}-${++n}`;
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
        passwordService: { hashPassword: () => Promise.resolve('x') } as never,
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
});
