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

  it('deletes only the reset tokens of the account whose email matches in any casing', async () => {
    await repo.deleteTokensByUserEmail(
      'rt-owner@rt.test',
      TokenType.PASSWORD_RESET,
    );

    expect(await remaining()).toEqual(['rt-2', 'rt-3', 'rt-4']);
  });

  it('treats LIKE wildcards in the email literally', async () => {
    await repo.deleteTokensByUserEmail(
      'rt_owner@rt.test',
      TokenType.PASSWORD_RESET,
    );
    await repo.deleteTokensByUserEmail('%@rt.test', TokenType.PASSWORD_RESET);

    expect(await remaining()).toEqual(['rt-1', 'rt-2', 'rt-3', 'rt-4']);
  });

  it('consumes a token exactly once', async () => {
    const { id } = await prisma.token.findUniqueOrThrow({
      where: { token: 'rt-1' },
    });

    const results = await Promise.all([
      repo.consumeToken(id),
      repo.consumeToken(id),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(await remaining()).toEqual(['rt-2', 'rt-3', 'rt-4']);
  });
});
