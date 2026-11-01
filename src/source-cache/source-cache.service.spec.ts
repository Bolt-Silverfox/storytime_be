import {
  SourceCacheService,
  SourceCacheFetchError,
  SourceCacheLeaseTimeoutError,
  SourceCacheLeaseLostError,
  SourceCacheFetchTimeoutError,
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
  const prisma: any = { sourceCache: delegate };
  return { prisma, rows, delegate };
}

const fakeDbRef: { current: any } = { current: null };

/** In-memory lease; `busyFor` = number of claim() calls that fail first. */
function makeFakeLease(busyFor = 0, renewResult = true) {
  let busy = busyFor;
  const held = new Set<string>();
  const state = { revoked: false };
  return {
    state,
    fenced: jest.fn(
      async (key: string, _o: string, work: (db: any) => Promise<any>) => {
        if (state.revoked || !held.has(key)) return { held: false as const };
        return { held: true as const, value: await work(fakeDbRef.current) };
      },
    ) as any,

    held,
    claim: jest.fn((key: string) => {
      if (busy > 0) {
        busy--;
        return Promise.resolve(false);
      }
      held.add(key);
      return Promise.resolve(true);
    }),
    renew: jest.fn().mockResolvedValue(renewResult),
    release: jest.fn((key: string) => {
      held.delete(key);
      return Promise.resolve();
    }),
  };
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

  let lease: ReturnType<typeof makeFakeLease>;

  beforeEach(() => {
    fake = makeFakePrisma();
    fakeDbRef.current = fake.prisma;
    lease = makeFakeLease();
    svc = new SourceCacheService(fake.prisma, lease);
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
      expect(fetcher.mock.calls[0][0]).toBeNull();
      expect(fetcher.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
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
      // only the caller that ran the fetcher reports fetched=true
      expect([ra.fetched, rb.fetched]).toEqual([true, false]);
    });

    it('does not share a flight across different keys', async () => {
      const fetcher = jest.fn().mockResolvedValue(ok());
      await Promise.all([
        svc.getOrFetch('g', '1', fetcher, { now: NOW }),
        svc.getOrFetch('g', '2', fetcher, { now: NOW }),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('claims a lease around the fetch and releases it afterwards', async () => {
      await svc.getOrFetch('g', '1', jest.fn().mockResolvedValue(ok()), {
        now: NOW,
      });
      expect(lease.claim).toHaveBeenCalledTimes(1);
      expect(lease.release).toHaveBeenCalledTimes(1);
      expect(lease.held.size).toBe(0);
    });

    it('releases the lease when the fetcher throws', async () => {
      await expect(
        svc.getOrFetch('g', '1', jest.fn().mockRejectedValue(new Error('x')), {
          now: NOW,
        }),
      ).rejects.toThrow('x');
      expect(lease.held.size).toBe(0);
    });

    it('waits (polling, no fetch) while another holder has the lease, then fetches', async () => {
      lease = makeFakeLease(3);
      svc = new SourceCacheService(fake.prisma, lease);
      const fetcher = jest.fn().mockResolvedValue(ok());
      const r = await svc.getOrFetch('g', '1', fetcher, {
        now: NOW,
        pollMs: 1,
      });
      expect(lease.claim).toHaveBeenCalledTimes(4);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(r.fetched).toBe(true);
    });

    it("returns the other holder's result without fetching when it lands while waiting", async () => {
      lease = makeFakeLease(1000);
      svc = new SourceCacheService(fake.prisma, lease);
      const fetcher = jest.fn().mockResolvedValue(ok());
      const p = svc.getOrFetch('g', '1', fetcher, {
        pollMs: 5,
        waitTimeoutMs: 2000,
      });
      await new Promise((r) => setTimeout(r, 20));
      await svc.put({ sourceName: 'g', sourceId: '1', result: ok() });
      const r = await p;
      expect(fetcher).not.toHaveBeenCalled();
      expect(r.fetched).toBe(false);
    });

    it('gives up with SourceCacheLeaseTimeoutError if the lease never frees', async () => {
      lease = makeFakeLease(1000);
      svc = new SourceCacheService(fake.prisma, lease);
      const fetcher = jest.fn();
      await expect(
        svc.getOrFetch('g', '1', fetcher, { pollMs: 1, waitTimeoutMs: 30 }),
      ).rejects.toBeInstanceOf(SourceCacheLeaseTimeoutError);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('does not open a database transaction around the fetch', async () => {
      expect(fake.prisma.$transaction).toBeUndefined();
      await svc.getOrFetch('g', '1', jest.fn().mockResolvedValue(ok()), {
        now: NOW,
      });
    });
  });

  describe('lease loss and fencing', () => {
    const slow = (ms: number, over: Partial<FetchResult> = {}) =>
      jest.fn(
        (...args: [unknown, AbortSignal?]) =>
          new Promise<FetchResult>((r) =>
            setTimeout(() => r(ok(over)), ms + args.length * 0),
          ),
      );

    it('aborts the fetcher and skips the write when renew reports the lease lost', async () => {
      lease = makeFakeLease(0, false);
      svc = new SourceCacheService(fake.prisma, lease);
      // a newer winner already wrote a row
      await svc.put({
        sourceName: 'g',
        sourceId: '1',
        result: ok({ contentHash: 'B-new' }),
        now: new Date(NOW.getTime() - 10 * DAY),
        ttlMs: DAY,
      });
      const fetcher = slow(200, { contentHash: 'A-old' });
      const r = await svc.getOrFetch('g', '1', fetcher, {
        now: NOW,
        leaseMs: 30,
      });
      expect(fetcher.mock.calls[0][1]!.aborted).toBe(true);
      expect(r.fetched).toBe(false);
      expect(r.leaseLost).toBe(true);
      expect(r.stale).toBe(true); // seeded row is past revalidateAfter at NOW
      expect(r.entry.contentHash).toBe('B-new');
      expect((await svc.get('g', '1'))!.contentHash).toBe('B-new');
      expect((await svc.get('g', '1'))!.contentChanged).toBe(false);
    });

    it('flags stale=true when the lease was lost and only an expired older row exists', async () => {
      await svc.put({
        sourceName: 'g',
        sourceId: '1',
        result: ok({ contentHash: 'old' }),
        now: new Date(NOW.getTime() - 40 * DAY),
        ttlMs: DAY,
      });
      const fetcher = jest.fn(() => {
        lease.state.revoked = true;
        return Promise.resolve(ok({ contentHash: 'A-new' }));
      });
      const r = await svc.getOrFetch('g', '1', fetcher, { now: NOW });
      expect(r.fetched).toBe(false);
      expect(r.leaseLost).toBe(true);
      expect(r.stale).toBe(true);
      expect(r.entry.contentHash).toBe('old');
    });

    it('does not set leaseLost/stale on a normal fetch or cache hit', async () => {
      const f = jest.fn().mockResolvedValue(ok());
      const r1 = await svc.getOrFetch('g', '1', f, { now: NOW });
      const r2 = await svc.getOrFetch('g', '1', f, { now: NOW });
      expect(r1.leaseLost).toBeUndefined();
      expect(r2.leaseLost).toBeUndefined();
      expect(r2.stale).toBeUndefined();
    });

    it('fences the write: a revoked lease discards the result even if renew never noticed', async () => {
      const fetcher = jest.fn(() => {
        lease.state.revoked = true; // someone else took the expired lease
        return Promise.resolve(ok({ contentHash: 'A-old' }));
      });
      await expect(
        svc.getOrFetch('g', '1', fetcher, { now: NOW }),
      ).rejects.toBeInstanceOf(SourceCacheLeaseLostError);
      expect(await svc.get('g', '1')).toBeNull();
    });

    it('returns the current entry instead of throwing when the lease was lost but a row exists', async () => {
      const fetcher = jest.fn(async () => {
        await svc.put({
          sourceName: 'g',
          sourceId: '1',
          result: ok({ contentHash: 'B-new' }),
          now: NOW,
        });
        lease.state.revoked = true;
        return ok({ contentHash: 'A-old' });
      });
      const r = await svc.getOrFetch('g', '1', fetcher, {
        now: new Date(NOW.getTime() + 40 * DAY),
      });
      expect(r.fetched).toBe(false);
      expect(r.entry.contentHash).toBe('B-new');
    });

    // A fetcher that honours the signal rejects with AbortError on abort.
    const honouring = (ms: number) =>
      jest.fn(
        (_prev: unknown, signal: AbortSignal) =>
          new Promise<FetchResult>((resolve, reject) => {
            const t = setTimeout(
              () => resolve(ok({ contentHash: 'A-old' })),
              ms,
            );
            signal.addEventListener('abort', () => {
              clearTimeout(t);
              const e = new Error('The operation was aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }),
      );

    it("maps a signal-honouring fetcher's AbortError after lease loss to the lease-lost result", async () => {
      lease = makeFakeLease(0, false);
      svc = new SourceCacheService(fake.prisma, lease);
      await svc.put({
        sourceName: 'g',
        sourceId: '1',
        result: ok({ contentHash: 'B-new' }),
        now: new Date(NOW.getTime() - 10 * DAY),
        ttlMs: DAY,
      });
      const r = await svc.getOrFetch('g', '1', honouring(500), {
        now: NOW,
        leaseMs: 30,
      });
      expect(r.leaseLost).toBe(true);
      expect(r.fetched).toBe(false);
      expect(r.entry.contentHash).toBe('B-new');
    });

    it('throws SourceCacheLeaseLostError (not AbortError) when lease lost, fetcher aborts, and no entry exists', async () => {
      lease = makeFakeLease(0, false);
      svc = new SourceCacheService(fake.prisma, lease);
      await expect(
        svc.getOrFetch('g', '1', honouring(500), { now: NOW, leaseMs: 30 }),
      ).rejects.toBeInstanceOf(SourceCacheLeaseLostError);
    });

    // A fetcher that, once aborted, rejects with its OWN non-abort error.
    const failingOnAbort = (err: Error) =>
      jest.fn(
        (_prev: unknown, signal: AbortSignal) =>
          new Promise<FetchResult>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(err));
          }),
      );

    it('propagates a non-abort fetcher error raised after lease loss (not relabelled)', async () => {
      lease = makeFakeLease(0, false);
      svc = new SourceCacheService(fake.prisma, lease);
      await svc.put({
        sourceName: 'g',
        sourceId: '1',
        result: ok({ contentHash: 'B-new' }),
        now: new Date(NOW.getTime() - 10 * DAY),
        ttlMs: DAY,
      });
      const boom = new TypeError('upstream exploded');
      await expect(
        svc.getOrFetch('g', '1', failingOnAbort(boom), {
          now: NOW,
          leaseMs: 30,
        }),
      ).rejects.toBe(boom);
    });

    it('propagates a non-abort fetcher error raised after a timeout (not relabelled)', async () => {
      const boom = new Error('HTTP 502 from source');
      await expect(
        svc.getOrFetch('g', '1', failingOnAbort(boom), {
          now: NOW,
          fetchTimeoutMs: 30,
        }),
      ).rejects.toBe(boom);
      expect(lease.held.size).toBe(0);
    });

    it("maps a signal-honouring fetcher's AbortError after a timeout to SourceCacheFetchTimeoutError", async () => {
      await expect(
        svc.getOrFetch('g', '1', honouring(500), {
          now: NOW,
          fetchTimeoutMs: 30,
        }),
      ).rejects.toBeInstanceOf(SourceCacheFetchTimeoutError);
    });

    it('a hung fetcher is aborted after fetchTimeoutMs and the lease is released', async () => {
      let signal!: AbortSignal;
      const fetcher = jest.fn((_p: unknown, s: AbortSignal) => {
        signal = s;
        return new Promise<FetchResult>(() => undefined);
      });
      await expect(
        svc.getOrFetch('g', '1', fetcher, { now: NOW, fetchTimeoutMs: 30 }),
      ).rejects.toBeInstanceOf(SourceCacheFetchTimeoutError);
      expect(signal.aborted).toBe(true);
      expect(lease.held.size).toBe(0);
      expect(await svc.get('g', '1')).toBeNull();
    });
  });

  describe('upstream removal and 304 handling', () => {
    it('keeps the previous hash/payload and flags contentChanged when a 404 follows a 200', async () => {
      await svc.put({ sourceName: 's', sourceId: '1', result: ok(), now: NOW });
      const e = await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: { httpStatus: 404 },
        now: NOW,
      });
      expect(e.httpStatus).toBe(404);
      expect(e.contentHash).toBe('h1');
      expect(e.rawPayloadKey).toBe('raw/gutenberg/11.html');
      expect(e.contentChanged).toBe(true);
    });

    it('keeps the previous hash and flags when a 200 arrives with no hash', async () => {
      await svc.put({ sourceName: 's', sourceId: '1', result: ok(), now: NOW });
      const e = await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: { httpStatus: 200, contentHash: null },
        now: NOW,
      });
      expect(e.contentHash).toBe('h1');
      expect(e.contentChanged).toBe(true);
    });

    it('a first-time 404 is not flagged', async () => {
      const e = await svc.put({
        sourceName: 's',
        sourceId: '2',
        result: { httpStatus: 404 },
        now: NOW,
      });
      expect(e.contentChanged).toBe(false);
    });

    it('treats 304 with no stored row as an error and stores nothing', async () => {
      await expect(
        svc.getOrFetch(
          'g',
          '1',
          jest.fn().mockResolvedValue({ httpStatus: 304 }),
          {
            now: NOW,
          },
        ),
      ).rejects.toBeInstanceOf(SourceCacheFetchError);
      expect(await svc.get('g', '1')).toBeNull();
      expect(lease.held.size).toBe(0);
    });

    it('a 304 updates etag and lastModified validators', async () => {
      await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: ok({ etag: 'e1', lastModified: 'Mon' }),
        now: NOW,
        ttlMs: DAY,
      });
      const e = await svc.put({
        sourceName: 's',
        sourceId: '1',
        result: { httpStatus: 304, etag: 'e2', lastModified: 'Tue' },
        now: new Date(NOW.getTime() + 2 * DAY),
      });
      expect(e.etag).toBe('e2');
      expect(e.lastModified).toBe('Tue');
      expect(e.httpStatus).toBe(200);
    });
  });
});
