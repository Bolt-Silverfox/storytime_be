import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, SourceCache } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL_MS = 30 * DAY_MS;
export const DEFAULT_NOT_FOUND_TTL_MS = 7 * DAY_MS;
export const DEFAULT_LOCK_TIMEOUT_MS = 120_000;

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
  lockTimeoutMs?: number;
}

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
 * Concurrency: calls for one key are collapsed in-process (single-flight) and
 * serialised across processes with a Postgres advisory transaction lock, so a
 * second caller finds the first caller's row instead of fetching again.
 * Changed content only sets `contentChanged`; nothing here touches stories.
 */
@Injectable()
export class SourceCacheService {
  private readonly inFlight = new Map<string, Promise<GetOrFetchResult>>();

  constructor(private readonly prisma: PrismaService) {}

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

    // 304 Not Modified: nothing new, just extend freshness.
    const unchanged = result.httpStatus === 304 && existing;
    const status = unchanged ? existing.httpStatus : result.httpStatus;
    const ttl = isGone(status)
      ? (input.notFoundTtlMs ?? DEFAULT_NOT_FOUND_TTL_MS)
      : (input.ttlMs ?? DEFAULT_TTL_MS);
    const revalidateAfter = new Date(now.getTime() + ttl);

    if (unchanged) {
      return db.sourceCache.update({
        where: { sourceName_sourceId: { sourceName, sourceId } },
        data: {
          fetchedAt: now,
          revalidateAfter,
          fetchedBy: input.fetchedBy ?? existing.fetchedBy,
        },
      });
    }

    const newHash = result.contentHash ?? null;
    const hashChanged =
      !!existing?.contentHash && !!newHash && existing.contentHash !== newHash;

    const fields = {
      sourceUrl:
        result.sourceUrl ?? input.sourceUrl ?? existing?.sourceUrl ?? null,
      rawPayloadKey: result.rawPayloadKey ?? null,
      contentHash: newHash,
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
        contentChanged: hashChanged || (existing?.contentChanged ?? false),
        previousContentHash: hashChanged
          ? existing.contentHash
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
    const now = options.now ?? new Date();
    const hit = await this.get(sourceName, sourceId);
    if (hit && this.isFresh(hit, now)) return { entry: hit, fetched: false };

    const timeout = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    return this.prisma.$transaction(
      async (tx) => {
        // Serialise on the key across processes; released at commit/rollback.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source_cache:${sourceName}:${sourceId}`}, 0))`,
        );
        // Another caller may have populated it while we waited for the lock.
        const current = await this.get(sourceName, sourceId, tx);
        if (current && this.isFresh(current, now)) {
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
        const entry = await this.put(
          { sourceName, sourceId, result, ...options, now },
          tx,
        );
        return { entry, fetched: true };
      },
      { timeout, maxWait: timeout },
    );
  }
}
