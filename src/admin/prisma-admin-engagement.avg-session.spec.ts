import { PrismaAdminEngagementRepository } from './repositories/prisma-admin-engagement.repository';

describe('getAverageSessionSeconds', () => {
  function repoWith(rows: { createdAt: Date; lastActivityAt: Date | null }[]) {
    const prisma = { session: { findMany: jest.fn().mockResolvedValue(rows) } } as never;
    return new PrismaAdminEngagementRepository(prisma);
  }

  it('averages (lastActivityAt - createdAt) in seconds, excluding nulls', async () => {
    const base = new Date('2026-08-01T00:00:00Z').getTime();
    const repo = repoWith([
      { createdAt: new Date(base), lastActivityAt: new Date(base + 100_000) }, // 100s
      { createdAt: new Date(base), lastActivityAt: new Date(base + 300_000) }, // 300s
    ]);
    const avg = await repo.getAverageSessionSeconds(new Date(base - 1000), new Date(base + 1_000_000));
    expect(avg).toBe(200);
  });

  it('returns 0 when there are no qualifying sessions', async () => {
    const repo = repoWith([]);
    expect(await repo.getAverageSessionSeconds(new Date(), new Date())).toBe(0);
  });
});
