import { PrismaClient } from '@prisma/client';
import { PrismaAuthRepository } from './prisma-auth.repository';
import { PrismaService } from '../../prisma/prisma.service';

/** Scratch-DB spec; opt in with LAST_LOGIN_SCRATCH_DATABASE_URL (skipped otherwise). */
const url = process.env.LAST_LOGIN_SCRATCH_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PrismaAuthRepository.recordLastLogin (scratch DB)', () => {
  let prisma: PrismaClient;
  let repo: PrismaAuthRepository;
  const ids = ['rl-ok', 'rl-susp', 'rl-del'];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    repo = new PrismaAuthRepository(prisma as unknown as PrismaService);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.createMany({
      data: [
        { id: 'rl-ok', email: 'rl-ok@ll.test', passwordHash: 'x' },
        {
          id: 'rl-susp',
          email: 'rl-susp@ll.test',
          passwordHash: 'x',
          isSuspended: true,
        },
        {
          id: 'rl-del',
          email: 'rl-del@ll.test',
          passwordHash: 'x',
          isDeleted: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const get = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: { lastLoginAt: true, updatedAt: true },
    });

  it('sets lastLoginAt to now for an active user', async () => {
    const before = Date.now();
    await repo.recordLastLogin('rl-ok');
    const u = await get('rl-ok');
    expect(u.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('never sets it for suspended or deleted users', async () => {
    await repo.recordLastLogin('rl-susp');
    await repo.recordLastLogin('rl-del');
    expect((await get('rl-susp')).lastLoginAt).toBeNull();
    expect((await get('rl-del')).lastLoginAt).toBeNull();
  });

  it('is a no-op (no throw) for an unknown user', async () => {
    await expect(repo.recordLastLogin('rl-nope')).resolves.toBeUndefined();
  });
});
