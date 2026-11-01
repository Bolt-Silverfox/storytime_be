import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { SourceCache } from '@prisma/client';
import {
  GetOrFetchResult,
  SourceFetcher,
} from '@/source-cache/source-cache.service';
import { contentHashOf } from '@/shared/utils/content-hash.util';
import { AllowListEntry } from './allowlist.types';
import { effectiveStatus } from './allowlist';
import { GutenbergSource } from './gutenberg-source';
import { processGutenbergText, ProcessResult } from './gutenberg-text';

export const SOURCE_NAME = 'gutenberg';
export const LICENSE_CODE = 'PD-US';
export const LICENSE_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';
const WORDS_PER_MINUTE = 150; // keep in step with StoryGenerationService

export interface GutenbergCachePort {
  /** Read-only lookup, never writes. */
  peek(ebookId: string): Promise<SourceCache | null>;
  getOrFetch(
    ebookId: string,
    fetcher: SourceFetcher,
    opts: { ttlMs?: number; now?: Date },
  ): Promise<GetOrFetchResult>;
}

export interface PayloadStore {
  write(key: string, text: string): Promise<void>;
  read(key: string): Promise<string>;
}

export interface NewImportedStory {
  title: string;
  description: string;
  language: string;
  coverImageUrl: string;
  audioUrl: string;
  textContent: string;
  isInteractive: boolean;
  ageMin: number;
  ageMax: number;
  difficultyLevel: number;
  wordCount: number;
  durationSeconds: number;
  isPublished: boolean;
  aiGenerated: boolean;
  sourceName: string;
  sourceId: string;
  sourceUrl: string;
  licenseCode: string;
  licenseUrl: string;
  authorName: string;
  attributionText: string;
  adaptationNotes: string;
  importedAt: Date;
  contentHash: string;
  categoryIds: string[];
  themeIds: string[];
}

export class DuplicateStoryError extends Error {
  constructor() {
    super('Story already exists for this source id');
    this.name = 'DuplicateStoryError';
  }
}

export interface StoryStorePort {
  findBySource(ebookId: string): Promise<{
    id: string;
    contentHash: string | null;
    isPublished: boolean;
  } | null>;
  findByHash(hash: string): Promise<{ id: string } | null>;
  resolveTaxonomy(
    categories: string[],
    themes: string[],
  ): Promise<{
    categoryIds: string[];
    themeIds: string[];
    unmappedCategories: string[];
    unmappedThemes: string[];
  }>;
  /** Throws DuplicateStoryError on a (sourceName, sourceId) collision. */
  create(data: NewImportedStory): Promise<{ id: string }>;
}

export type Outcome =
  | 'create'
  | 'skip-exists'
  | 'skip-duplicate'
  | 'changed'
  | 'needs-review'
  | 'needs-editorial-retell'
  | 'excluded'
  | 'rejected'
  | 'missing-in-source'
  | 'error';

export interface ReportItem {
  ebookId: string;
  title: string;
  outcome: Outcome;
  reason?: string;
  written: boolean;
  storyId?: string;
  unmapped?: { categories: string[]; themes: string[] };
}

export interface ImportReport {
  mode: 'dry-run' | 'commit';
  items: ReportItem[];
  summary: Record<string, number>;
}

export interface GutenbergImporterDeps {
  source: GutenbergSource;
  cache: GutenbergCachePort;
  store: StoryStorePort;
  payloads: PayloadStore;
  allowList: AllowListEntry[];
  now?: () => Date;
  logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
}

export interface RunOptions {
  /** Default 'dry-run': nothing is written. */
  mode?: 'dry-run' | 'commit';
  only?: string;
  ttlMs?: number;
}

const urlFor = (id: string) => `https://www.gutenberg.org/ebooks/${id}`;

export function buildAttribution(e: AllowListEntry): string {
  const parts = [`${e.title} by ${e.authorName}`];
  if (e.translator) parts.push(`translated by ${e.translator.name}`);
  if (e.illustrator) parts.push(`original illustrations by ${e.illustrator}`);
  return `${parts.join('; ')}. Public domain in the United States. Text cleaned and formatted for Storytime; wording unchanged.`;
}

export class GutenbergImporter {
  private readonly log: Pick<Logger, 'log' | 'warn' | 'error'>;
  private readonly now: () => Date;

  constructor(private readonly deps: GutenbergImporterDeps) {
    this.log = deps.logger ?? new Logger('GutenbergImporter');
    this.now = deps.now ?? (() => new Date());
  }

  async run(opts: RunOptions = {}): Promise<ImportReport> {
    const mode = opts.mode ?? 'dry-run';
    const items: ReportItem[] = [];
    let entries = this.deps.allowList;
    if (opts.only !== undefined) {
      const hit = entries.find((e) => e.ebookId === opts.only);
      if (!hit) {
        items.push({
          ebookId: opts.only,
          title: '',
          outcome: 'rejected',
          reason: 'not on the allow-list',
          written: false,
        });
        entries = [];
      } else {
        entries = [hit];
      }
    }
    for (const entry of entries) {
      let item: ReportItem;
      try {
        item = await this.one(entry, mode, opts);
      } catch (err) {
        item = {
          ebookId: entry.ebookId,
          title: entry.title,
          outcome: 'error',
          reason: (err as Error).message,
          written: false,
        };
      }
      this.log.log(
        `${mode} ${item.ebookId} ${item.outcome}${item.reason ? ` (${item.reason})` : ''}`,
      );
      items.push(item);
    }
    const summary: Record<string, number> = {};
    for (const i of items) summary[i.outcome] = (summary[i.outcome] ?? 0) + 1;
    return { mode, items, summary };
  }

  private async one(
    entry: AllowListEntry,
    mode: 'dry-run' | 'commit',
    opts: RunOptions,
  ): Promise<ReportItem> {
    const base = { ebookId: entry.ebookId, title: entry.title, written: false };
    const eff = effectiveStatus(entry, this.now());
    if (eff.status !== 'approved') {
      return { ...base, outcome: eff.status, reason: eff.reason };
    }

    const loaded = await this.load(entry, mode, opts);
    if (loaded.kind === 'missing') {
      return {
        ...base,
        outcome: 'missing-in-source',
        reason: 'not found in the source directory',
      };
    }
    const processed = loaded.processed;
    if (!processed.ok) {
      return { ...base, outcome: 'needs-review', reason: processed.reason };
    }

    const hash = contentHashOf(processed.content);
    const existing = await this.deps.store.findBySource(entry.ebookId);
    if (existing) {
      if (existing.contentHash && existing.contentHash !== hash) {
        // Upstream text moved on. Flag only: never update or publish.
        return {
          ...base,
          outcome: 'changed',
          reason:
            'upstream content differs from the stored story; needs human review',
          storyId: existing.id,
        };
      }
      return { ...base, outcome: 'skip-exists', storyId: existing.id };
    }
    const dupe = await this.deps.store.findByHash(hash);
    if (dupe) {
      return {
        ...base,
        outcome: 'skip-duplicate',
        reason: 'same content hash as an existing story',
        storyId: dupe.id,
      };
    }

    const tax = await this.deps.store.resolveTaxonomy(
      entry.categories,
      entry.themes,
    );
    const unmapped = {
      categories: tax.unmappedCategories,
      themes: tax.unmappedThemes,
    };
    if (mode === 'dry-run') {
      return { ...base, outcome: 'create', unmapped };
    }

    const data: NewImportedStory = {
      title: entry.title,
      description: entry.description,
      language: 'en',
      coverImageUrl: '', // no cover art; column is non-null
      audioUrl: '',
      textContent: processed.content,
      isInteractive: false,
      ageMin: entry.ageMin,
      ageMax: entry.ageMax,
      difficultyLevel: entry.difficultyLevel ?? 1,
      wordCount: processed.wordCount,
      durationSeconds: Math.ceil((processed.wordCount / WORDS_PER_MINUTE) * 60),
      isPublished: false,
      aiGenerated: false,
      sourceName: SOURCE_NAME,
      sourceId: entry.ebookId,
      sourceUrl: urlFor(entry.ebookId),
      licenseCode: LICENSE_CODE,
      licenseUrl: LICENSE_URL,
      authorName: entry.authorName,
      attributionText: buildAttribution(entry),
      adaptationNotes: `Imported unmodified in wording. Changes: ${processed.notes.join('; ')}.`,
      importedAt: this.now(),
      contentHash: hash,
      categoryIds: tax.categoryIds,
      themeIds: tax.themeIds,
    };
    try {
      const { id } = await this.deps.store.create(data);
      return {
        ...base,
        outcome: 'create',
        written: true,
        storyId: id,
        unmapped,
      };
    } catch (err) {
      if (err instanceof DuplicateStoryError) {
        return {
          ...base,
          outcome: 'skip-exists',
          reason: 'created concurrently',
        };
      }
      throw err;
    }
  }

  private async load(
    entry: AllowListEntry,
    mode: 'dry-run' | 'commit',
    opts: RunOptions,
  ): Promise<{ kind: 'missing' } | { kind: 'ok'; processed: ProcessResult }> {
    const id = entry.ebookId;
    const { source, cache, payloads } = this.deps;

    if (mode === 'dry-run') {
      const hit = await cache.peek(id);
      if (hit) {
        if (hit.httpStatus === 404 || !hit.rawPayloadKey)
          return { kind: 'missing' };
        return {
          kind: 'ok',
          processed: processGutenbergText(
            await payloads.read(hit.rawPayloadKey),
            entry,
          ),
        };
      }
      const r = await source.fetch(id, new AbortController().signal);
      if (r.status !== 200) return { kind: 'missing' };
      return { kind: 'ok', processed: processGutenbergText(r.text, entry) };
    }

    const fetcher: SourceFetcher = async (_prev, signal) => {
      const r = await source.fetch(id, signal);
      if (r.status !== 200) return { httpStatus: 404, sourceUrl: urlFor(id) };
      const p = processGutenbergText(r.text, entry);
      // Hash the cleaned story text so cosmetic edition changes (dates,
      // producer credits) do not raise contentChanged.
      const contentHash = contentHashOf(p.ok ? p.content : r.text);
      const key = `${SOURCE_NAME}/${id}-${createHash('sha256').update(r.text).digest('hex').slice(0, 16)}.txt`;
      await payloads.write(key, r.text);
      return {
        httpStatus: 200,
        rawPayloadKey: key,
        contentHash,
        sourceUrl: urlFor(id),
        lastModified: r.lastModified ?? null,
        licenseSnapshot: 'US public domain (PD-US) per curated allow-list',
      };
    };
    const { entry: cached } = await cache.getOrFetch(id, fetcher, {
      ttlMs: opts.ttlMs,
      now: this.now(),
    });
    if (cached.httpStatus === 404 || !cached.rawPayloadKey)
      return { kind: 'missing' };
    return {
      kind: 'ok',
      processed: processGutenbergText(
        await payloads.read(cached.rawPayloadKey),
        entry,
      ),
    };
  }
}
