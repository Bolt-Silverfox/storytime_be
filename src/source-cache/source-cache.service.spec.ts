import {
  SourceCacheService,
  SourceCacheFetchError,
  FetchResult,
} from './source-cache.service';

type Row = Record<string, any>;

/** In-memory stand-in for the sourceCache delegate + transaction plumbing. */
function makeFakePrisma() {
  const rows = new Map<string, Row>();
  const key = (w: any) =>
    `${w.sourceName_sourceId.sourceName}|${w.sourceName_sourceId.sourceId}`;
  const delegate = {
    findUnique: jest.fn(({ where }: any) =>
      Promise.resolve(rows.get(key(where)) ?? null),
    ),
    upsert: jest.fn(({ where, create, update }: any) => {
      const k = key(where);
      const existing = rows.get(k);
      const next = existing
        ? { ...existing, ...update }
        : { id: `id-${rows.size + 1}`, ...create };
      rows.set(k, next);
      return Promise.resolve(next);
    }),
    update: jest.fn(({ where, data }: any) => {
      const k = key(where);
      const next = { ...rows.get(k), ...data };
      rows.set(k, next);
      return Promise.resolve(next);
    }),
  };
  const prisma: any = {
    sourceCache: delegate,
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn((fn: any) =>
      fn({ sourceCache: delegate, $executeRaw: prisma.$executeRaw }),
    ),
  };
  return { prisma, rows, delegate };
}

const NOW = new Date('2026-11-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ok = (over: Partial<FetchResult> = {}): FetchResult => ({
  httpStatus: 200,
  rawPayloadKey: 'raw/gutenberg/11.html',
  contentHash: 'h1',
  ...over,
});

describe('SourceCacheService', () => {
  let svc: SourceCacheService;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    fake = makeFakePrisma();
    svc = new SourceCacheService(fake.prisma);
  });

  describe('isFresh / needsRevalidation', () => {
    const entry = (revalidateAfter: Date) => ({ revalidateAfter }) as any;

    it('is fresh strictly before revalidateAfter', () => {
      const e = entry(new Date(NOW.getTime() + 1));
      expect(svc.isFresh(e, NOW)).toBe(true);
      expect(svc.needsRevalidation(e, NOW)).toBe(false);
    });

    it('is stale at and after revalidateAfter', () => {
      const e = entry(NOW);
      expect(svc.isFresh(e, NOW)).toBe(false);
      expect(svc.needsRevalidation(e, NOW)).toBe(true);
    });
  });

  describe('put / get', () => {
    it('stores metadata only (no payload field) and returns it via get', async () => {
      await svc.put({
        sourceName: 'gutenberg',
        sourceId: '11',
        sourceUrl: 'https://example.org/11',
        result: ok({ licenseSnapshot: 'Public domain in the USA.' }),
        fetchedBy: 'test',
        now: NOW,
        ttlMs: DAY,
      });
      const got = await svc.get('gutenberg', '11');
      expect(got).toMatchObject({
        sourceName: 'gutenberg',
        sourceId: '11',
        httpStatus: 200,
        rawPayloadKey: 'raw/gutenberg/11.html',
        licenseSnapshot: 'Public domain in the USA.',
        fetchedBy: 'test',
        contentChanged: false,
      });
      expect(got!.revalidateAfter).toEqual(new Date(NOW.getTime() + DAY));
      expect(got).not.toHaveProperty('payload');
      expect(got).not.toHaveProperty('rawPayload');
    });

    it('flags contentChanged and keeps the previous hash when the hash differs', async () => {
      await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: ok({ contentHash: 'h1' }),
        now: NOW,
      });
      const second = await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: ok({ contentHash: 'h2' }),
        now: NOW,
      });
      expect(second.contentChanged).toBe(true);
      expect(second.previousContentHash).toBe('h1');
      expect(second.contentHash).toBe('h2');
    });

    it('does not flag when the hash is unchanged, and keeps an earlier flag', async () => {
      await svc.put({ sourceName: 's', sourceId: '1', result: ok(), now: NOW });
      await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: ok({ contentHash: 'h2' }),
        now: NOW,
      });
      const same = await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: ok({ contentHash: 'h2' }),
        now: NOW,
      });
      expect(same.contentChanged).toBe(true); // sticky until acknowledged
      await svc.acknowledgeChange('s', '1');
      expect((await svc.get('s', '1'))!.contentChanged).toBe(false);
    });

    it('does not flag the first fetch', async () => {
      const e = await svc.put({
        sourceName: 's',
        sourceId: '9',
        result: ok(),
        now: NOW,
      });
      expect(e.contentChanged).toBe(false);
      expect(e.previousContentHash).toBeNull();
    });
  });

  describe('getOrFetch', () => {
    it('calls the fetcher on a miss and stores the result', async () => {
      const fetcher = jest.fn().mockResolvedValue(ok());
      const r = await svc.getOrFetch('gutenberg', '11', fetcher, { now: NOW });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(null);
      expect(r.fetched).toBe(true);
      expect(r.entry.contentHash).toBe('h1');
    });

    it('returns a fresh entry without calling the fetcher', async () => {
      const fetcher = jest.fn().mockResolvedValue(ok());
      await svc.getOrFetch('g', '1', fetcher, { now: NOW, ttlMs: DAY });
      const again = await svc.getOrFetch('g', '1', fetcher, {
        now: new Date(NOW.getTime() + DAY / 2),
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(again.fetched).toBe(false);
    });

    it('re-fetches an expired entry and passes the previous entry (for etag)', async () => {
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce(ok({ etag: 'e1' }))
        .mockResolvedValueOnce(ok({ etag: 'e2' }));
      await svc.getOrFetch('g', '1', fetcher, { now: NOW, ttlMs: DAY });
      const later = new Date(NOW.getTime() + 2 * DAY);
      const r = await svc.getOrFetch('g', '1', fetcher, { now: later });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toMatchObject({ etag: 'e1' });
      expect(r.entry.etag).toBe('e2');
      expect(r.fetched).toBe(true);
    });

    it('treats a 304 as "unchanged": keeps stored fields, extends freshness', async () => {
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce(ok({ etag: 'e1', contentHash: 'h1' }))
        .mockResolvedValueOnce({ httpStatus: 304 });
      await svc.getOrFetch('g', '1', fetcher, { now: NOW, ttlMs: DAY });
      const later = new Date(NOW.getTime() + 2 * DAY);
      const r = await svc.getOrFetch('g', '1', fetcher, {
        now: later,
        ttlMs: DAY,
      });
      expect(r.entry.httpStatus).toBe(200);
      expect(r.entry.contentHash).toBe('h1');
      expect(r.entry.contentChanged).toBe(false);
      expect(r.entry.revalidateAfter).toEqual(new Date(later.getTime() + DAY));
    });

    it('caches 404s (no payload) and does not re-fetch them while fresh', async () => {
      const fetcher = jest.fn().mockResolvedValue({ httpStatus: 404 });
      const r1 = await svc.getOrFetch('g', 'gone', fetcher, { now: NOW });
      const r2 = await svc.getOrFetch('g', 'gone', fetcher, { now: NOW });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(r1.entry.httpStatus).toBe(404);
      expect(r1.entry.rawPayloadKey).toBeNull();
      expect(r2.fetched).toBe(false);
    });

    it('does not cache transient failures (5xx/429) and surfaces an error', async () => {
      const fetcher = jest.fn().mockResolvedValue({ httpStatus: 503 });
      await expect(
        svc.getOrFetch('g', '1', fetcher, { now: NOW }),
      ).rejects.toBeInstanceOf(SourceCacheFetchError);
      expect(await svc.get('g', '1')).toBeNull();
    });

    it('does not cache anything when the fetcher throws', async () => {
      const fetcher = jest.fn().mockRejectedValue(new Error('network down'));
      await expect(
        svc.getOrFetch('g', '1', fetcher, { now: NOW }),
      ).rejects.toThrow('network down');
      expect(await svc.get('g', '1')).toBeNull();
    });

    it('calls the fetcher once for concurrent calls on the same key (single-flight)', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const fetcher = jest.fn(async () => {
        await gate;
        return ok();
      });
      const a = svc.getOrFetch('g', '1', fetcher, { now: NOW });
      const b = svc.getOrFetch('g', '1', fetcher, { now: NOW });
      await new Promise((r) => setImmediate(r));
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(ra.entry.id).toBe(rb.entry.id);
    });

    it('does not share a flight across different keys', async () => {
      const fetcher = jest.fn().mockResolvedValue(ok());
      await Promise.all([
        svc.getOrFetch('g', '1', fetcher, { now: NOW }),
        svc.getOrFetch('g', '2', fetcher, { now: NOW }),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('takes a per-key Postgres advisory lock inside the transaction', async () => {
      await svc.getOrFetch('g', '1', jest.fn().mockResolvedValue(ok()), {
        now: NOW,
      });
      expect(fake.prisma.$transaction).toHaveBeenCalled();
      expect(fake.prisma.$executeRaw).toHaveBeenCalled();
    });
  });
});
