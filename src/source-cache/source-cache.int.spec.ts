import { PrismaClient } from '@prisma/client';
import {
  PrismaFetchLease,
  SourceCacheService,
  FetchLease,
} from './source-cache.service';

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

  it('calls the fetcher once for concurrent getOrFetch from two services (lease)', async () => {
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

  describe('no pool connection is held while fetching or waiting', () => {
    it('slow fetches on many keys do not starve unrelated queries (pool of 3)', async () => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('connection_limit', '3');
      url.searchParams.set('pool_timeout', '2');
      const small = new PrismaClient({ datasourceUrl: url.toString() });
      await small.$connect();
      const svc = new SourceCacheService(small as any);
      const fetcher = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 4000));
        return { httpStatus: 200, contentHash: 'h' };
      });
      try {
        const running = [1, 2, 3, 4, 5, 6].map((i) =>
          svc.getOrFetch(source, `starve${i}`, fetcher),
        );
        // same key from a second service: a waiter must not hold a connection
        const waiter = new SourceCacheService(small as any).getOrFetch(
          source,
          'starve1',
          fetcher,
          { pollMs: 100 },
        );
        await new Promise((r) => setTimeout(r, 1000));
        await expect(small.story.count()).resolves.toEqual(expect.any(Number));
        await Promise.all([...running, waiter]);
        expect(fetcher).toHaveBeenCalledTimes(6);
      } finally {
        await small.$disconnect();
      }
    }, 30000);
  });

  describe('losing the lease', () => {
    const key = (id: string) => `${source}\u0000${id}`;

    it("PrismaFetchLease.release deletes only the caller's own lease (key AND owner)", async () => {
      const lease = new PrismaFetchLease(prisma);
      await prisma.$executeRaw`INSERT INTO "source_fetch_lease" ("sourceName","sourceId","lockedBy","expiresAt")
        VALUES (${source}, 'own', 'other-owner', (now() at time zone 'utc') + interval '1 minute')`;
      await lease.release(key('own'), 'me');
      expect(
        await prisma.sourceFetchLease.count({
          where: {
            sourceName: source,
            sourceId: 'own',
            lockedBy: 'other-owner',
          },
        }),
      ).toBe(1);
      await lease.release(key('own'), 'other-owner');
      expect(
        await prisma.sourceFetchLease.count({
          where: { sourceName: source, sourceId: 'own' },
        }),
      ).toBe(0);
    });

    it("renew only extends the owner's lease", async () => {
      const lease = new PrismaFetchLease(prisma);
      expect(await lease.claim(key('rn'), 'a', 60000)).toBe(true);
      expect(await lease.claim(key('rn'), 'b', 60000)).toBe(false);
      expect(await lease.renew(key('rn'), 'b', 60000)).toBe(false);
      expect(await lease.renew(key('rn'), 'a', 60000)).toBe(true);
    });

    it('renew always false: the stale holder discards its result; ONE winner, newer data kept', async () => {
      const real = new PrismaFetchLease(prisma);
      const noRenew: FetchLease = {
        claim: (k, o, l) => real.claim(k, o, l),
        renew: () => Promise.resolve(false),
        release: (k, o) => real.release(k, o),
        fenced: (k, o, w) => real.fenced(k, o, w),
      };
      const stale = new SourceCacheService(prisma as any, noRenew);
      const fresh = new SourceCacheService(prisma2 as any);
      const pA = stale.getOrFetch(
        source,
        'lost1',
        async () => {
          await new Promise((r) => setTimeout(r, 1800));
          return { httpStatus: 200, contentHash: 'A-old' };
        },
        { leaseMs: 300 },
      );
      await new Promise((r) => setTimeout(r, 700)); // A's lease has expired
      const b = await fresh.getOrFetch(source, 'lost1', () =>
        Promise.resolve({ httpStatus: 200, contentHash: 'B-new' }),
      );
      expect(b.fetched).toBe(true);
      const a = await pA;
      expect(a.fetched).toBe(false);
      expect(a.entry.contentHash).toBe('B-new');
      const row = await prisma.sourceCache.findFirstOrThrow({
        where: { sourceName: source, sourceId: 'lost1' },
      });
      expect(row.contentHash).toBe('B-new');
      expect(row.contentChanged).toBe(false);
      expect(row.previousContentHash).toBeNull();
    }, 20000);

    it("A's pool is hogged so its real renew times out: stale result is discarded", async () => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('connection_limit', '1');
      url.searchParams.set('pool_timeout', '1');
      const hogged = new PrismaClient({ datasourceUrl: url.toString() });
      await hogged.$connect();
      const stale = new SourceCacheService(hogged as any);
      const fresh = new SourceCacheService(prisma2 as any);
      try {
        const pA = stale.getOrFetch(
          source,
          'lost2',
          async () => {
            // hog A's only connection: renew (and A's own write) cannot run
            void hogged.$transaction(
              async (tx) => {
                await tx.$executeRaw`SELECT pg_sleep(2.5)`;
              },
              { timeout: 10000 },
            );
            await new Promise((r) => setTimeout(r, 3000));
            return { httpStatus: 200, contentHash: 'A-old' };
          },
          { leaseMs: 600 },
        );
        await new Promise((r) => setTimeout(r, 1200));
        const b = await fresh.getOrFetch(source, 'lost2', () =>
          Promise.resolve({ httpStatus: 200, contentHash: 'B-new' }),
        );
        expect(b.fetched).toBe(true);
        const a = await pA;
        expect(a.entry.contentHash).toBe('B-new');
        const row = await prisma.sourceCache.findFirstOrThrow({
          where: { sourceName: source, sourceId: 'lost2' },
        });
        expect(row.contentHash).toBe('B-new');
        expect(row.contentChanged).toBe(false);
      } finally {
        await hogged.$disconnect();
      }
    }, 30000);
  });

  describe('lease semantics', () => {
    it('a fetcher slower than the lease is not double-fetched (heartbeat) and its result is stored', async () => {
      const fetcher = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return { httpStatus: 200, contentHash: 'slow', rawPayloadKey: 'k' };
      });
      const [a, b] = await Promise.all([
        svcA.getOrFetch(source, 'slow', fetcher, { leaseMs: 400, pollMs: 50 }),
        svcB.getOrFetch(source, 'slow', fetcher, { leaseMs: 400, pollMs: 50 }),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(a.entry.id).toBe(b.entry.id);
      expect(a.entry.rawPayloadKey).toBe('k');
    }, 20000);

    it('a crashed holder (lease never released) is superseded after expiry', async () => {
      await prisma.$executeRaw`INSERT INTO "source_fetch_lease" ("sourceName","sourceId","lockedBy","expiresAt")
        VALUES (${source}, 'crash', 'dead-process', (now() at time zone 'utc') + interval '1 second')`;
      const fetcher = jest
        .fn()
        .mockResolvedValue({ httpStatus: 200, contentHash: 'h' });
      const t0 = Date.now();
      const r = await svcA.getOrFetch(source, 'crash', fetcher, {
        pollMs: 100,
      });
      expect(r.fetched).toBe(true);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }, 15000);

    it('releases the lease when the fetcher throws, so the next call fetches immediately', async () => {
      await expect(
        svcA.getOrFetch(source, 'boom', () =>
          Promise.reject(new Error('boom')),
        ),
      ).rejects.toThrow('boom');
      const t0 = Date.now();
      const r = await svcA.getOrFetch(source, 'boom', () =>
        Promise.resolve({ httpStatus: 200, contentHash: 'h' }),
      );
      expect(r.fetched).toBe(true);
      expect(Date.now() - t0).toBeLessThan(500);
    });
  });

  afterEach(async () => {
    await prisma.sourceFetchLease.deleteMany({ where: { sourceName: source } });
  });
});
