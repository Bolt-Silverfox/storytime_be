import { PrismaClient } from '@prisma/client';
import { PrismaAuthRepository } from './prisma-auth.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenType } from '../dto/auth.dto';

const url = process.env.RESET_TOKENS_SCRATCH_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PrismaAuthRepository reset tokens (scratch DB)', () => {
  let prisma: PrismaClient;
  let repo: PrismaAuthRepository;
  const users = [
    { id: 'rt-owner', email: 'RT-Owner@rt.test' },
    { id: 'rt-under', email: 'rtxowner@rt.test' },
    { id: 'rt-other', email: 'rt-other@rt.test' },
  ];
  const expiresAt = new Date(Date.now() + 3600_000);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    repo = new PrismaAuthRepository(prisma as unknown as PrismaService);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await prisma.user.createMany({
      data: users.map((u) => ({ ...u, passwordHash: 'x' })),
    });
    await prisma.token.createMany({
      data: [
        {
          userId: 'rt-owner',
          token: 'rt-1',
          type: TokenType.PASSWORD_RESET,
          expiresAt,
        },
        {
          userId: 'rt-owner',
          token: 'rt-2',
          type: TokenType.VERIFICATION,
          expiresAt,
        },
        {
          userId: 'rt-under',
          token: 'rt-3',
          type: TokenType.PASSWORD_RESET,
          expiresAt,
        },
        {
          userId: 'rt-other',
          token: 'rt-4',
          type: TokenType.PASSWORD_RESET,
          expiresAt,
        },
      ],
    });
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({
        where: { id: { in: users.map((u) => u.id) } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  const remaining = async () =>
    (
      await prisma.token.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        select: { token: true },
        orderBy: { token: 'asc' },
      })
    ).map((t) => t.token);

  const claimAndWrite = (id: string, userId: string) =>
    repo.transaction(async (tx) => {
      const claimed = await tx.consumeToken(id);
      if (claimed) {
        await tx.updateUser(userId, { passwordHash: 'new' });
        await tx.deleteAllUserSessions(userId);
      }
      return claimed;
    });

  it('claims a token exactly once across concurrent transactions', async () => {
    const { id } = await prisma.token.findUniqueOrThrow({
      where: { token: 'rt-1' },
    });

    const results = await Promise.all([
      claimAndWrite(id, 'rt-owner'),
      claimAndWrite(id, 'rt-owner'),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(await remaining()).toEqual(['rt-2', 'rt-3', 'rt-4']);
  });

  it('keeps a claimed token when the password write fails, so a retry can still use it', async () => {
    const { id } = await prisma.token.findUniqueOrThrow({
      where: { token: 'rt-1' },
    });
    let claimedBeforeFailure = false;

    await expect(
      repo.transaction(async (tx) => {
        claimedBeforeFailure = await tx.consumeToken(id);
        await tx.updateUser('no-such-user', { passwordHash: 'new' });
      }),
    ).rejects.toThrow();

    expect(claimedBeforeFailure).toBe(true);
    expect(await remaining()).toEqual(['rt-1', 'rt-2', 'rt-3', 'rt-4']);
    await expect(claimAndWrite(id, 'rt-owner')).resolves.toBe(true);
  });

  it('does not claim a token that expired before the transaction', async () => {
    const { id } = await prisma.token.update({
      where: { token: 'rt-1' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(claimAndWrite(id, 'rt-owner')).resolves.toBe(false);
    expect(await remaining()).toEqual(['rt-1', 'rt-2', 'rt-3', 'rt-4']);
  });

  it('does not claim a token that expired while waiting for a claim that rolled back', async () => {
    const expiresAt = new Date(Date.now() + 1500);
    const { id } = await prisma.token.update({
      where: { token: 'rt-1' },
      data: { expiresAt },
    });
    let firstClaimed!: (claimed: boolean) => void;
    const claimedByFirst = new Promise<boolean>((resolve) => {
      firstClaimed = resolve;
    });
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = repo
      .transaction(async (tx) => {
        firstClaimed(await tx.consumeToken(id));
        await firstReleased;
        throw new Error('rolled back');
      })
      .catch((error: Error) => error.message);
    expect(await claimedByFirst).toBe(true);
    const second = claimAndWrite(id, 'rt-owner');

    let waitingOnLock = 0;
    for (let i = 0; i < 100 && waitingOnLock === 0; i++) {
      const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()`;
      waitingOnLock = row.waiting;
      if (waitingOnLock === 0) await new Promise((r) => setTimeout(r, 10));
    }
    expect(waitingOnLock).toBe(1);
    expect(Date.now()).toBeLessThan(expiresAt.getTime());

    await new Promise((r) =>
      setTimeout(r, expiresAt.getTime() - Date.now() + 50),
    );
    releaseFirst();

    expect(await first).toBe('rolled back');
    expect(await second).toBe(false);
    expect(await remaining()).toEqual(['rt-1', 'rt-2', 'rt-3', 'rt-4']);
  }, 15_000);

  it('claims a verification token once across concurrent verifications and marks the email verified', async () => {
    const { id } = await prisma.token.findUniqueOrThrow({
      where: { token: 'rt-2' },
    });
    const verify = () =>
      repo.transaction(async (tx) => {
        if (!(await tx.consumeToken(id))) return false;
        await tx.markEmailVerified('rt-owner');
        return true;
      });

    const results = await Promise.all([verify(), verify()]);

    expect(results.sort()).toEqual([false, true]);
    expect(await remaining()).toEqual(['rt-1', 'rt-3', 'rt-4']);
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: 'rt-owner' },
    });
    expect(owner.isEmailVerified).toBe(true);
    expect(owner.onboardingStatus).toBe('email_verified');
  });

  it('deletes a token that is already gone without failing', async () => {
    const { id } = await prisma.token.findUniqueOrThrow({
      where: { token: 'rt-1' },
    });
    await repo.deleteToken(id);

    await expect(repo.deleteToken(id)).resolves.toBeUndefined();
    expect(await remaining()).toEqual(['rt-2', 'rt-3', 'rt-4']);
  });
});
