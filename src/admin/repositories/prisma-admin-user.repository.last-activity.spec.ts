import { PrismaClient } from '@prisma/client';
import { PrismaAdminUserRepository } from './prisma-admin-user.repository';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Runs against a scratch Postgres (migrations applied). Opt in with
 * LAST_LOGIN_SCRATCH_DATABASE_URL; skipped otherwise so CI/unit runs stay hermetic.
 */
const url = process.env.LAST_LOGIN_SCRATCH_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PrismaAdminUserRepository.findLastActivityByUserIds (scratch DB)', () => {
  let prisma: PrismaClient;
  let repo: PrismaAdminUserRepository;
  const ids = ['ll-u1', 'll-u2', 'll-u3', 'll-u4'];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    repo = new PrismaAdminUserRepository(prisma as unknown as PrismaService);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.createMany({
      data: ids.map((id) => ({
        id,
        email: `${id}@ll.test`,
        passwordHash: 'x',
      })),
    });
    const s = (
      userId: string,
      n: string,
      lastActivityAt: Date | null,
      isDeleted = false,
    ) => ({
      userId,
      token: `ll-${n}`,
      expiresAt: new Date('2030-01-01'),
      lastActivityAt,
      isDeleted,
    });
    await prisma.session.createMany({
      data: [
        s('ll-u1', 'a', new Date('2026-10-01T00:00:00Z')),
        s('ll-u1', 'b', new Date('2026-10-05T00:00:00Z')),
        s('ll-u1', 'c', new Date('2026-10-09T00:00:00Z'), true), // deleted: ignored
        s('ll-u2', 'd', null), // never active
        s('ll-u3', 'e', new Date('2026-09-01T00:00:00Z')),
      ],
    });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('returns the max lastActivityAt of non-deleted sessions per user, in one call', async () => {
    const m = await repo.findLastActivityByUserIds(ids);
    expect(m.get('ll-u1')).toEqual(new Date('2026-10-05T00:00:00Z'));
    expect(m.get('ll-u3')).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('omits users with only null-activity sessions or no sessions', async () => {
    const m = await repo.findLastActivityByUserIds(ids);
    expect(m.has('ll-u2')).toBe(false);
    expect(m.has('ll-u4')).toBe(false);
  });

  it('returns an empty map for no ids', async () => {
    expect((await repo.findLastActivityByUserIds([])).size).toBe(0);
  });
});
