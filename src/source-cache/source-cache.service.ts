import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, SourceCache } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL_MS = 30 * DAY_MS;
export const DEFAULT_NOT_FOUND_TTL_MS = 7 * DAY_MS;
export const DEFAULT_LEASE_MS = 60_000;
export const DEFAULT_WAIT_TIMEOUT_MS = 180_000;
export const DEFAULT_POLL_MS = 250;
export const MAX_POLL_MS = 2_000;
export const SOURCE_FETCH_LEASE = Symbol('SOURCE_FETCH_LEASE');

/** What a fetcher reports. The fetcher stores the payload itself. */
export interface FetchResult {
  httpStatus: number;
  /** Object-store key / file path of the raw payload. Never the payload. */
  rawPayloadKey?: string | null;
  /** sha256 of the normalised content (see content-hash.util). */
  contentHash?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  /** Licence/rights statement as seen at fetch time. */
  licenseSnapshot?: string | null;
  sourceUrl?: string | null;
}

/** Receives the previous entry (if any) so it can send If-None-Match etc. */
export type SourceFetcher = (
  previous: SourceCache | null,
) => Promise<FetchResult>;

export interface CacheOptions {
  now?: Date;
  ttlMs?: number;
  notFoundTtlMs?: number;
  fetchedBy?: string;
  sourceUrl?: string;
  /** How long a claimed lease lives without a heartbeat (crash recovery). */
  leaseMs?: number;
  /** Max time to wait for another holder before giving up. */
  waitTimeoutMs?: number;
  /** Initial poll interval while waiting (backs off to 2 s). */
  pollMs?: number;
}

/** Claim/renew/release of the per-key fetch lease. No connection is held. */
export interface FetchLease {
  claim(key: LeaseKey, owner: string, leaseMs: number): Promise<boolean>;
  renew(key: LeaseKey, owner: string, leaseMs: number): Promise<boolean>;
  release(key: LeaseKey, owner: string): Promise<void>;
}
export type LeaseKey = string; // `${sourceName}\u0000${sourceId}`

export interface PutInput extends CacheOptions {
  sourceName: string;
  sourceId: string;
  result: FetchResult;
}

export interface GetOrFetchResult {
  entry: SourceCache;
  /** true when the fetcher ran for this call; false = served from cache. */
  fetched: boolean;
}

/** Thrown for responses that must not be cached (5xx, 429, other 4xx). */
export class SourceCacheFetchError extends Error {
  constructor(
    readonly sourceName: string,
    readonly sourceId: string,
    readonly httpStatus: number,
  ) {
    super(
      `Source fetch for ${sourceName}/${sourceId} returned HTTP ${httpStatus}; not cached`,
    );
    this.name = 'SourceCacheFetchError';
  }
}

/** Thrown when another holder kept the lease for longer than waitTimeoutMs. */
export class SourceCacheLeaseTimeoutError extends Error {
  constructor(sourceName: string, sourceId: string) {
    super(`Timed out waiting for the fetch lease on ${sourceName}/${sourceId}`);
    this.name = 'SourceCacheLeaseTimeoutError';
  }
}

const splitKey = (key: LeaseKey): [string, string] => {
  const [a, b] = key.split('\u0000');
  return [a, b];
};

/**
 * Postgres-backed lease. Each call is a single short statement on the shared
 * pool and returns the connection immediately; expiry uses the DB clock (UTC).
 */
export class PrismaFetchLease implements FetchLease {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(key: LeaseKey, owner: string, leaseMs: number) {
    const [name, id] = splitKey(key);
    const rows = await this.prisma.$queryRaw<{ lockedBy: string }[]>`
      INSERT INTO "source_fetch_lease" ("sourceName","sourceId","lockedBy","expiresAt")
      VALUES (${name}, ${id}, ${owner},
        (now() at time zone 'utc') + make_interval(secs => ${leaseMs / 1000}::double precision))
      ON CONFLICT ("sourceName","sourceId") DO UPDATE
        SET "lockedBy" = EXCLUDED."lockedBy", "expiresAt" = EXCLUDED."expiresAt"
        WHERE "source_fetch_lease"."expiresAt" < (now() at time zone 'utc')
      RETURNING "lockedBy"`;
    return rows.length === 1 && rows[0].lockedBy === owner;
  }

  async renew(key: LeaseKey, owner: string, leaseMs: number) {
    const [name, id] = splitKey(key);
    const n = await this.prisma.$executeRaw`
      UPDATE "source_fetch_lease"
      SET "expiresAt" = (now() at time zone 'utc') + make_interval(secs => ${leaseMs / 1000}::double precision)
      WHERE "sourceName" = ${name} AND "sourceId" = ${id} AND "lockedBy" = ${owner}`;
    return n === 1;
  }

  async release(key: LeaseKey, owner: string) {
    const [name, id] = splitKey(key);
    await this.prisma.sourceFetchLease.deleteMany({
      where: { sourceName: name, sourceId: id, lockedBy: owner },
    });
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Db = Pick<PrismaClient, 'sourceCache'>;

const isCacheable = (status: number) =>
  (status >= 200 && status < 300) ||
  status === 304 ||
  status === 404 ||
  status === 410;
const isGone = (status: number) => status === 404 || status === 410;

/**
 * "Fetch once" cache for story sources. Importers must read only through
 * getOrFetch so a source site/API is hit once per TTL.
 *
 * Concurrency: calls for one key are collapsed in-process (single-flight; later
 * callers share the first caller's fetcher and options) and serialised across
 * processes with a lease row (see PrismaFetchLease). The fetch runs OUTSIDE any
 * transaction and holds no pool connection, neither does a waiter (it polls
 * the cache with backoff). A lease is renewed by a heartbeat while the fetcher
 * runs and expires on its own if the holder crashes.
 * Changed content only sets `contentChanged`; nothing here touches stories.
 */
@Injectable()
export class SourceCacheService {
  private readonly inFlight = new Map<string, Promise<GetOrFetchResult>>();

  private readonly logger = new Logger(SourceCacheService.name);
  private readonly lease: FetchLease;
  private readonly owner = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(SOURCE_FETCH_LEASE) lease?: FetchLease,
  ) {
    this.lease = lease ?? new PrismaFetchLease(prisma);
  }

  get(sourceName: string, sourceId: string, db: Db = this.prisma) {
    return db.sourceCache.findUnique({
      where: { sourceName_sourceId: { sourceName, sourceId } },
    });
  }

  isFresh(entry: Pick<SourceCache, 'revalidateAfter'>, now: Date = new Date()) {
    return entry.revalidateAfter.getTime() > now.getTime();
  }

  needsRevalidation(
    entry: Pick<SourceCache, 'revalidateAfter'>,
    now: Date = new Date(),
  ) {
    return !this.isFresh(entry, now);
  }

  /** Clear the contentChanged flag after a human has reviewed the change. */
  acknowledgeChange(sourceName: string, sourceId: string) {
    return this.prisma.sourceCache.update({
      where: { sourceName_sourceId: { sourceName, sourceId } },
      data: { contentChanged: false },
    });
  }

  async put(input: PutInput, db: Db = this.prisma): Promise<SourceCache> {
    const { sourceName, sourceId, result } = input;
    const now = input.now ?? new Date();
    const existing = await this.get(sourceName, sourceId, db);
    const is304 = result.httpStatus === 304;

    if (is304 && !existing) {
      // Nothing to revalidate against: a conditional-request bug in the fetcher.
      throw new SourceCacheFetchError(sourceName, sourceId, 304);
    }

    // 304 Not Modified: keep stored data, refresh validators and freshness.
    const status = is304 ? existing!.httpStatus : result.httpStatus;
    const ttl = isGone(status)
      ? (input.notFoundTtlMs ?? DEFAULT_NOT_FOUND_TTL_MS)
      : (input.ttlMs ?? DEFAULT_TTL_MS);
    const revalidateAfter = new Date(now.getTime() + ttl);

    if (is304) {
      return db.sourceCache.update({
        where: { sourceName_sourceId: { sourceName, sourceId } },
        data: {
          fetchedAt: now,
          revalidateAfter,
          etag: result.etag ?? existing!.etag,
          lastModified: result.lastModified ?? existing!.lastModified,
          fetchedBy: input.fetchedBy ?? existing!.fetchedBy,
        },
      });
    }

    const newHash = result.contentHash ?? null;
    const previousHash = existing?.contentHash ?? null;
    // Removed upstream (404/410) or a response we could not hash, after we had
    // content: keep the last known hash/payload and flag it for review rather
    // than silently forgetting what we imported.
    const lostContent = !!previousHash && !newHash;
    const hashChanged = !!previousHash && !!newHash && previousHash !== newHash;
    const flag = hashChanged || lostContent;

    const fields = {
      sourceUrl:
        result.sourceUrl ?? input.sourceUrl ?? existing?.sourceUrl ?? null,
      rawPayloadKey: lostContent
        ? (existing?.rawPayloadKey ?? null)
        : (result.rawPayloadKey ?? null),
      contentHash: lostContent ? previousHash : newHash,
      httpStatus: result.httpStatus,
      etag: result.etag ?? null,
      lastModified: result.lastModified ?? null,
      fetchedAt: now,
      revalidateAfter,
      licenseSnapshot: result.licenseSnapshot ?? null,
      fetchedBy: input.fetchedBy ?? null,
    };

    return db.sourceCache.upsert({
      where: { sourceName_sourceId: { sourceName, sourceId } },
      create: {
        sourceName,
        sourceId,
        ...fields,
        contentChanged: false,
        previousContentHash: null,
      },
      update: {
        ...fields,
        // Sticky: stays true until acknowledgeChange() even if a later fetch
        // returns the same (new) hash.
        contentChanged: flag || (existing?.contentChanged ?? false),
        previousContentHash: hashChanged
          ? previousHash
          : (existing?.previousContentHash ?? null),
      },
    });
  }

  /**
   * Return the cached entry when fresh; otherwise call `fetcher` exactly once
   * (across concurrent callers and processes) and cache the outcome.
   * 404/410 are cached; 5xx/429/other failures and fetcher exceptions are not
   * cached and are thrown.
   */
  getOrFetch(
    sourceName: string,
    sourceId: string,
    fetcher: SourceFetcher,
    options: CacheOptions = {},
  ): Promise<GetOrFetchResult> {
    const key = `${sourceName}\u0000${sourceId}`;
    const running = this.inFlight.get(key);
    if (running) return running;

    const flight = this.run(sourceName, sourceId, fetcher, options).finally(
      () => this.inFlight.delete(key),
    );
    this.inFlight.set(key, flight);
    return flight;
  }

  private async run(
    sourceName: string,
    sourceId: string,
    fetcher: SourceFetcher,
    options: CacheOptions,
  ): Promise<GetOrFetchResult> {
    const nowFn = () => options.now ?? new Date();
    const hit = await this.get(sourceName, sourceId);
    if (hit && this.isFresh(hit, nowFn()))
      return { entry: hit, fetched: false };

    const key: LeaseKey = `${sourceName}\u0000${sourceId}`;
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const deadline =
      Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    let poll = options.pollMs ?? DEFAULT_POLL_MS;

    // Claim the lease; while someone else holds it, poll the cache (no
    // connection is held between polls) and take their result if it lands.
    while (!(await this.lease.claim(key, this.owner, leaseMs))) {
      if (Date.now() >= deadline) {
        throw new SourceCacheLeaseTimeoutError(sourceName, sourceId);
      }
      await sleep(poll);
      poll = Math.min(poll * 2, MAX_POLL_MS);
      const landed = await this.get(sourceName, sourceId);
      if (landed && this.isFresh(landed, nowFn())) {
        return { entry: landed, fetched: false };
      }
    }

    const beat = setInterval(
      () => {
        this.lease.renew(key, this.owner, leaseMs).catch((e: unknown) => {
          this.logger.warn(
            `Lease renew failed for ${sourceName}/${sourceId}: ${String(e)}`,
          );
        });
      },
      Math.max(10, Math.floor(leaseMs / 3)),
    );
    beat.unref();
    try {
      // Re-check under the lease: the previous holder may just have finished.
      const current = await this.get(sourceName, sourceId);
      if (current && this.isFresh(current, nowFn())) {
        return { entry: current, fetched: false };
      }
      const result = await fetcher(current);
      if (!isCacheable(result.httpStatus)) {
        throw new SourceCacheFetchError(
          sourceName,
          sourceId,
          result.httpStatus,
        );
      }
      const entry = await this.put({
        sourceName,
        sourceId,
        result,
        ...options,
        now: nowFn(),
      });
      return { entry, fetched: true };
    } finally {
      clearInterval(beat);
      await this.lease.release(key, this.owner).catch((e: unknown) => {
        this.logger.warn(
          `Lease release failed for ${sourceName}/${sourceId}: ${String(e)}`,
        );
      });
    }
  }
}
