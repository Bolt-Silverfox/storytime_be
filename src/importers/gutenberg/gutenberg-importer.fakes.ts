import { SourceCache } from '@prisma/client';
import { GetOrFetchResult, SourceFetcher } from '@/source-cache/source-cache.service';
import {
  GutenbergCachePort,
  PayloadStore,
  StoryStorePort,
  NewImportedStory,
} from './gutenberg-importer';
import { GutenbergFetchResult, GutenbergSource } from './gutenberg-source';

/** In-memory source. `texts` maps ebook id -> text. Counts calls. */
export class FakeGutenbergSource implements GutenbergSource {
  calls: string[] = [];
  constructor(public texts: Record<string, string>) {}
  fetch(id: string): Promise<GutenbergFetchResult> {
    this.calls.push(id);
    const text = this.texts[id];
    return Promise.resolve(
      text === undefined
        ? { status: 404 }
        : { status: 200, text, sourceUrl: null, lastModified: null },
    );
  }
}

export class MemoryPayloads implements PayloadStore {
  files = new Map<string, string>();
  writes = 0;
  write(key: string, text: string) {
    this.writes++;
    this.files.set(key, text);
    return Promise.resolve();
  }
  read(key: string) {
    const v = this.files.get(key);
    return v === undefined
      ? Promise.reject(new Error('payload missing'))
      : Promise.resolve(v);
  }
}

/** Mimics SourceCacheService semantics we rely on: fetch once, ttl, hash change flag. */
export class FakeCache implements GutenbergCachePort {
  entries = new Map<string, SourceCache>();
  getOrFetchCalls = 0;
  now = new Date('2026-11-01T00:00:00Z');
  peek(id: string) {
    return Promise.resolve(this.entries.get(id) ?? null);
  }
  async getOrFetch(
    id: string,
    fetcher: SourceFetcher,
    opts: { ttlMs?: number },
  ): Promise<GetOrFetchResult> {
    this.getOrFetchCalls++;
    const hit = this.entries.get(id);
    if (hit && hit.revalidateAfter > this.now) {
      return { entry: hit, fetched: false };
    }
    const r = await fetcher(hit ?? null, new AbortController().signal);
    const changed =
      !!hit && !!hit.contentHash && !!r.contentHash && hit.contentHash !== r.contentHash;
    const entry = {
      ...(hit ?? {}),
      id: hit?.id ?? `c-${id}`,
      sourceName: 'gutenberg',
      sourceId: id,
      sourceUrl: r.sourceUrl ?? null,
      rawPayloadKey: r.rawPayloadKey ?? hit?.rawPayloadKey ?? null,
      contentHash: r.contentHash ?? hit?.contentHash ?? null,
      contentChanged: hit?.contentChanged || changed,
      previousContentHash: changed ? hit!.contentHash : (hit?.previousContentHash ?? null),
      httpStatus: r.httpStatus,
      revalidateAfter: new Date(this.now.getTime() + (opts.ttlMs ?? 30 * 86400000)),
    } as SourceCache;
    this.entries.set(id, entry);
    return { entry, fetched: true };
  }
}

export class MemoryStore implements StoryStorePort {
  rows: (NewImportedStory & { id: string; contentHash: string })[] = [];
  creates = 0;
  categories = new Set(['Fairytales & Folktales', 'Bedtime']);
  themes = new Set(['Courage / Bravery']);
  findBySource(sourceId: string) {
    const r = this.rows.find((x) => x.sourceId === sourceId);
    return Promise.resolve(
      r ? { id: r.id, contentHash: r.contentHash, isPublished: r.isPublished } : null,
    );
  }
  findByHash(hash: string) {
    const r = this.rows.find((x) => x.contentHash === hash);
    return Promise.resolve(r ? { id: r.id } : null);
  }
  resolveTaxonomy(categories: string[], themes: string[]) {
    return Promise.resolve({
      categoryIds: categories.filter((c) => this.categories.has(c)),
      themeIds: themes.filter((c) => this.themes.has(c)),
      unmappedCategories: categories.filter((c) => !this.categories.has(c)),
      unmappedThemes: themes.filter((c) => !this.themes.has(c)),
    });
  }
  create(data: NewImportedStory) {
    this.creates++;
    const id = `s${this.rows.length + 1}`;
    this.rows.push({ ...data, id, contentHash: data.contentHash });
    return Promise.resolve({ id });
  }
}
