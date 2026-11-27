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
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await prisma.$disconnect();
  });

  const remaining = async () =>
    (
      await prisma.token.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        select: { token: true },
        orderBy: { token: 'asc' },
      })
    ).map((t) => t.token);

  const found = async (email: string) =>
    (await repo.findTokensByUserEmail(email, TokenType.PASSWORD_RESET))
      .map((t) => t.token)
      .sort();

  it('finds only the reset tokens of the account whose email matches in any casing', async () => {
    expect(await found('rt-owner@rt.test')).toEqual(['rt-1']);
  });

  it('treats LIKE wildcards in the email literally', async () => {
    expect(await found('rt_owner@rt.test')).toEqual([]);
    expect(await found('%@rt.test')).toEqual([]);
  });

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

  it('keeps the token when the password write fails inside the transaction', async () => {
    const { id } = await prisma.token.findUniqueOrThrow({
      where: { token: 'rt-1' },
    });

    await expect(claimAndWrite(id, 'no-such-user')).rejects.toThrow();

    expect(await remaining()).toEqual(['rt-1', 'rt-2', 'rt-3', 'rt-4']);
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
