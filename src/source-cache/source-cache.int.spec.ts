import { PrismaClient } from '@prisma/client';
import { SourceCacheService } from './source-cache.service';

/**
 * Real-Postgres tests for the source cache. Skipped when no DATABASE_URL.
 * No network: fetchers are in-process fakes.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('SourceCacheService (real Postgres)', () => {
  const prisma = new PrismaClient();
  // A second client + service = a second "process" sharing only the database.
  const prisma2 = new PrismaClient();
  const svcA = new SourceCacheService(prisma as any);
  const svcB = new SourceCacheService(prisma2 as any);
  const source = `it_${Date.now()}`;

  // Open both pools up front so connection setup isn't counted in test time.
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), prisma2.$connect()]);
  });

  afterEach(async () => {
    await prisma.sourceCache.deleteMany({ where: { sourceName: source } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await prisma2.$disconnect();
  });

  it('enforces unique (sourceName, sourceId)', async () => {
    const base = {
      sourceName: source,
      sourceId: 'dup',
      httpStatus: 200,
      revalidateAfter: new Date(),
    };
    await prisma.sourceCache.create({ data: base });
    await expect(
      prisma.sourceCache.create({ data: base }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('calls the fetcher once for concurrent getOrFetch from two services (advisory lock)', async () => {
    const fetcher = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { httpStatus: 200, contentHash: 'h', rawPayloadKey: 'k' };
    });
    const [a, b] = await Promise.all([
      svcA.getOrFetch(source, 'c1', fetcher),
      svcB.getOrFetch(source, 'c1', fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect([a.fetched, b.fetched].sort()).toEqual([false, true]);
    expect(a.entry.id).toBe(b.entry.id);
    expect(
      await prisma.sourceCache.count({ where: { sourceName: source } }),
    ).toBe(1);
  });

  it('calls the fetcher once for concurrent calls on one service', async () => {
    const fetcher = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { httpStatus: 200, contentHash: 'h' };
    });
    await Promise.all([
      svcA.getOrFetch(source, 'c2', fetcher),
      svcA.getOrFetch(source, 'c2', fetcher),
      svcA.getOrFetch(source, 'c2', fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caches a 404 and does not call the fetcher again', async () => {
    const fetcher = jest.fn().mockResolvedValue({ httpStatus: 404 });
    const r1 = await svcA.getOrFetch(source, 'nf', fetcher);
    const r2 = await svcA.getOrFetch(source, 'nf', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r1.entry.httpStatus).toBe(404);
    expect(r2.fetched).toBe(false);
    const row = await prisma.sourceCache.findFirst({
      where: { sourceName: source, sourceId: 'nf' },
    });
    expect(row?.httpStatus).toBe(404);
    expect(row?.rawPayloadKey).toBeNull();
  });

  it('flags contentChanged when an expired entry comes back with a new hash', async () => {
    const past = new Date(Date.now() - 1000);
    await svcA.put({
      sourceName: source,
      sourceId: 'chg',
      result: { httpStatus: 200, contentHash: 'old' },
      now: past,
      ttlMs: 1,
    });
    const r = await svcA.getOrFetch(source, 'chg', () =>
      Promise.resolve({ httpStatus: 200, contentHash: 'new' }),
    );
    expect(r.fetched).toBe(true);
    expect(r.entry.contentChanged).toBe(true);
    expect(r.entry.previousContentHash).toBe('old');
    const row = await prisma.sourceCache.findFirstOrThrow({
      where: { sourceName: source, sourceId: 'chg' },
    });
    expect(row.contentChanged).toBe(true);
  });

  it('never creates or publishes a story when content changes', async () => {
    const before = await prisma.story.count();
    await svcA.put({
      sourceName: source,
      sourceId: 'np',
      result: { httpStatus: 200, contentHash: 'a' },
      ttlMs: 1,
      now: new Date(Date.now() - 1000),
    });
    await svcA.getOrFetch(source, 'np', () =>
      Promise.resolve({ httpStatus: 200, contentHash: 'b' }),
    );
    expect(await prisma.story.count()).toBe(before);
  });
});
