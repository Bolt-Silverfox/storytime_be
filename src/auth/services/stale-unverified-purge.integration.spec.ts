import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaStaleUnverifiedRepository } from '../repositories/prisma-stale-unverified.repository';
import {
  DISPOSABLE_USER_RELATIONS,
  staleUnverifiedWhere,
} from '../repositories/stale-unverified.selection';

const url = process.env.PASSWORDLESS_TEST_DATABASE_URL;
const maybe = url && /throwaway|_test/.test(url) ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

describe('stale unverified selection covers every user relation', () => {
  it('constrains or explicitly allows each relation on User', () => {
    const user = Prisma.dmmf.datamodel.models.find((m) => m.name === 'User')!;
    const relations = user.fields
      .filter((f) => f.kind === 'object')
      .map((f) => f.name);
    const keysOf = (w: Prisma.UserWhereInput): string[] => [
      ...Object.keys(w),
      ...[
        ...((w.AND as Prisma.UserWhereInput[]) ?? []),
        ...((w.OR as Prisma.UserWhereInput[]) ?? []),
      ].flatMap(keysOf),
    ];
    const constrained = keysOf(staleUnverifiedWhere(new Date()));
    const unaccounted = relations.filter(
      (r) =>
        !constrained.includes(r) &&
        !(DISPOSABLE_USER_RELATIONS as readonly string[]).includes(r),
    );
    expect(unaccounted).toEqual([]);
  });
});

maybe('stale unverified accounts against Postgres', () => {
  let prisma: PrismaClient;
  let repo: PrismaStaleUnverifiedRepository;
  let n = 0;
  const cutoff = () => new Date(Date.now() - 30 * DAY);

  const make = async (
    overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
  ) => {
    const email = `purge-it-${process.pid}-${++n}@example.com`;
    return prisma.user.create({
      data: {
        email,
        passwordHash: 'h',
        name: 'Purge Test',
        isEmailVerified: false,
        createdAt: new Date(Date.now() - 45 * DAY),
        ...overrides,
      },
    });
  };
  const eligibleIds = async () =>
    new Set(await repo.findEligibleIds(cutoff(), 10_000));

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    repo = new PrismaStaleUnverifiedRepository(prisma as never);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'purge-it-' } },
    });
    await prisma.learningExpectation.deleteMany({
      where: { name: { startsWith: 'purge-it-' } },
    });
    await prisma.$disconnect();
  });

  it('selects a bare old unverified account and one with only disposable rows', async () => {
    const bare = await make();
    const disposable = await make();
    await prisma.profile.create({
      data: { userId: disposable.id, country: 'NG' },
    });
    await prisma.session.create({
      data: {
        userId: disposable.id,
        token: `s-${disposable.id}`,
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    await prisma.token.create({
      data: {
        userId: disposable.id,
        token: `t-${disposable.id}`,
        type: 'verification',
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    await prisma.deviceToken.create({
      data: {
        userId: disposable.id,
        token: `d-${disposable.id}`,
        platform: 'ios',
      },
    });
    await prisma.userUsage.create({
      data: { userId: disposable.id, currentMonth: '2026-10' },
    });

    const ids = await eligibleIds();
    expect(ids.has(bare.id)).toBe(true);
    expect(ids.has(disposable.id)).toBe(true);
  });

  it('skips verified, recent, admin, linked and suspended accounts', async () => {
    const skipped = [
      await make({ isEmailVerified: true }),
      await make({ createdAt: new Date(Date.now() - 29 * DAY) }),
      await make({ role: 'admin' }),
      await make({ googleId: `g-${++n}-${process.pid}` }),
      await make({ appleId: `a-${++n}-${process.pid}` }),
      await make({ isSuspended: true }),
      await make({ premiumAccessUntil: new Date(Date.now() + DAY) }),
    ];
    const ids = await eligibleIds();
    for (const u of skipped) expect(ids.has(u.id)).toBe(false);
  });

  it('skips every account that has dependent data', async () => {
    const withKid = await make();
    await prisma.kid.create({ data: { parentId: withKid.id, name: 'k' } });

    const withSubscription = await make();
    await prisma.subscription.create({
      data: { userId: withSubscription.id, plan: 'monthly' },
    });

    const withTicket = await make();
    await prisma.supportTicket.create({
      data: { userId: withTicket.id, subject: 's', message: 'm' },
    });

    const withPaymentMethod = await make();
    await prisma.paymentMethod.create({
      data: { userId: withPaymentMethod.id, type: 'card', details: '{}' },
    });

    const withVoice = await make();
    await prisma.voice.create({
      data: { userId: withVoice.id, name: 'v', type: 'custom' } as never,
    });

    const withProfile = await make();
    await prisma.profile.create({
      data: { userId: withProfile.id, country: 'NG', language: 'English' },
    });

    const withUsage = await make();
    await prisma.userUsage.create({
      data: {
        userId: withUsage.id,
        currentMonth: '2026-10',
        uniqueStoriesRead: 2,
      },
    });

    const withExpectation = await make();
    const expectation = await prisma.learningExpectation.create({
      data: { name: `purge-it-${process.pid}-${++n}` },
    });
    await prisma.userLearningExpectation.create({
      data: {
        userId: withExpectation.id,
        learningExpectationId: expectation.id,
      },
    });

    const skipped = [
      withKid,
      withSubscription,
      withTicket,
      withPaymentMethod,
      withVoice,
      withProfile,
      withUsage,
      withExpectation,
    ];
    const ids = await eligibleIds();
    for (const u of skipped) expect(ids.has(u.id)).toBe(false);
  });

  it('counts exactly what it selects', async () => {
    const eligible = await eligibleIds();
    const total = await repo.countEligible(cutoff());
    expect(total).toBe(eligible.size);
  });

  it('deletes in bounded batches and cascades disposable rows', async () => {
    const a = await make();
    const b = await make();
    await prisma.token.create({
      data: {
        userId: a.id,
        token: `t-${a.id}`,
        type: 'verification',
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    const batch = await repo.findEligibleIds(cutoff(), 1);
    expect(batch).toHaveLength(1);

    const removed = await repo.deleteEligibleByIds([a.id, b.id], cutoff());

    expect(removed).toBe(2);
    expect(
      await prisma.user.count({ where: { id: { in: [a.id, b.id] } } }),
    ).toBe(0);
    expect(await prisma.token.count({ where: { userId: a.id } })).toBe(0);
  });

  it('re-checks eligibility at delete time so a just-verified user survives', async () => {
    const racing = await make();
    const stale = await repo.findEligibleIds(cutoff(), 10_000);
    expect(stale).toContain(racing.id);
    await prisma.user.update({
      where: { id: racing.id },
      data: { isEmailVerified: true },
    });
    await prisma.kid.create({ data: { parentId: racing.id, name: 'late' } });

    const removed = await repo.deleteEligibleByIds([racing.id], cutoff());

    expect(removed).toBe(0);
    expect(await prisma.user.count({ where: { id: racing.id } })).toBe(1);
  });
});
