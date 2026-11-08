import * as fs from 'fs';
import * as path from 'path';
import { GutenbergImporter } from './gutenberg-importer';
import { AllowListEntry } from './allowlist.types';
import { GUTENBERG_REFERENCE } from './gutenberg-text';
import {
  FakeCache,
  FakeGutenbergSource,
  MemoryPayloads,
  MemoryStore,
} from '@/shared/testing/gutenberg-importer.fakes';

const fx = (n: string) =>
  fs.readFileSync(path.resolve('test/fixtures/gutenberg', n), 'utf8');

const e = (over: Partial<AllowListEntry>): AllowListEntry => ({
  ebookId: '90001',
  title: 'The Little Lantern Fox',
  authorName: 'Ada Example',
  translator: { name: 'Bram Sample', deathYear: 1900 },
  firstPublished: 1890,
  status: 'approved',
  flags: [],
  ageMin: 4,
  ageMax: 7,
  difficultyLevel: 2,
  categories: ['Fairytales & Folktales', 'Not A Category'],
  themes: ['Courage / Bravery'],
  description: 'A fox borrows a light.',
  expect: { title: 'Lantern Fox', author: 'Example' },
  pdJustification: 'invented',
  idVerified: true,
  ...over,
});

const LIST: AllowListEntry[] = [
  e({}),
  e({
    ebookId: '90002',
    title: 'The Moon Spoon',
    authorName: 'Cy Invented',
    translator: undefined,
    illustrator: 'Dot Drawn',
    categories: ['Bedtime'],
    themes: [],
    expect: { title: 'Moon Spoon', author: 'Invented' },
  }),
  e({
    ebookId: '90003',
    title: 'Flagged',
    flags: ['dated-content'],
    translator: undefined,
    expect: { title: 'x', author: 'x' },
  }),
  e({
    ebookId: '90004',
    title: 'Lost Marker',
    translator: undefined,
    expect: { title: 'Lost Marker', author: 'Example' },
  }),
  e({
    ebookId: '90005',
    title: 'Wrong Id',
    translator: undefined,
    expect: { title: 'Wrong', author: 'Nobody' },
  }),
  e({
    ebookId: '90007',
    title: 'Pending',
    status: 'needs-review',
    statusReason: 'translator unknown',
    translator: undefined,
  }),
  e({
    ebookId: '90008',
    title: 'Out',
    status: 'excluded',
    statusReason: 'copyrighted translation',
    translator: undefined,
  }),
  e({
    ebookId: '90009',
    title: 'Absent',
    translator: undefined,
    expect: { title: 'a', author: 'a' },
  }),
];

const TEXTS = () => ({
  '90001': fx('90001-0.txt'),
  '90002': fx('90002.txt'),
  '90003': fx('90003-0.txt'),
  '90004': fx('90004-0.txt'),
  '90005': fx('90005-0.txt'),
});

function setup(texts: Record<string, string> = TEXTS()) {
  const source = new FakeGutenbergSource(texts);
  const cache = new FakeCache();
  const store = new MemoryStore();
  const payloads = new MemoryPayloads();
  const mk = (at = new Date('2026-11-01T00:00:00Z')) =>
    new GutenbergImporter({
      source,
      cache,
      store,
      payloads,
      allowList: LIST,
      now: () => at,
    });
  return { source, cache, store, payloads, importer: mk(), mk };
}

const outcomes = (r: { items: { ebookId: string; outcome: string }[] }) =>
  Object.fromEntries(r.items.map((i) => [i.ebookId, i.outcome]));

describe('GutenbergImporter', () => {
  it('commit creates only approved works, unpublished, with full provenance', async () => {
    const { importer, store } = setup();
    const r = await importer.run({ mode: 'commit' });
    expect(outcomes(r)).toEqual({
      '90001': 'create',
      '90002': 'create',
      '90003': 'needs-editorial-retell',
      '90004': 'needs-review',
      '90005': 'needs-review',
      '90007': 'needs-review',
      '90008': 'excluded',
      '90009': 'missing-in-source',
    });
    expect(store.rows).toHaveLength(2);
    for (const s of store.rows) {
      expect(s.isPublished).toBe(false);
      expect(s.sourceName).toBe('gutenberg');
      expect(s.licenseCode).toBe('PD-US');
      expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(s.adaptationNotes).toMatch(/removed/i);
      expect(s.sourceUrl).toMatch(/^https:\/\//);
      expect(s.aiGenerated).toBe(false);
    }
    const fox = store.rows.find((s) => s.sourceId === '90001')!;
    expect(fox.authorName).toBe('Ada Example');
    expect(fox.attributionText).toContain('Ada Example');
    expect(fox.attributionText).toContain('Bram Sample');
    expect(fox.ageMin).toBe(4);
    expect(fox.durationSeconds).toBeGreaterThan(0);
    const spoon = store.rows.find((s) => s.sourceId === '90002')!;
    expect(spoon.attributionText).not.toContain('Dot Drawn'); // pictures not imported
    expect(spoon.adaptationNotes).toMatch(
      /illustrations? (are )?not included/i,
    );
    expect(r.items.find((i) => i.ebookId === '90001')!.unmapped).toEqual({
      categories: ['Not A Category'],
      themes: [],
    });
  });

  it('property: no Gutenberg string in any stored text field', async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit' });
    for (const s of store.rows) {
      for (const f of [
        s.title,
        s.description,
        s.textContent,
        s.attributionText,
        s.authorName,
        s.adaptationNotes,
      ]) {
        expect(f).not.toMatch(GUTENBERG_REFERENCE);
        expect(f).not.toMatch(/ebook\s*#?\s*\d|proofreading|pgdp/i);
      }
    }
  });

  it('dry-run is the default shape: writes no story, no cache row, no payload', async () => {
    const { importer, store, cache, payloads } = setup();
    const r = await importer.run({ mode: 'dry-run' });
    expect(outcomes(r)['90001']).toBe('create');
    expect(r.items.find((i) => i.ebookId === '90001')!.written).toBe(false);
    expect(store.creates).toBe(0);
    expect(cache.getOrFetchCalls).toBe(0);
    expect(cache.entries.size).toBe(0);
    expect(payloads.writes).toBe(0);
  });

  it('run() with no mode is a dry run', async () => {
    const { importer, store } = setup();
    await importer.run({});
    expect(store.creates).toBe(0);
  });

  it('second run is idempotent and the source is read once per work', async () => {
    const { importer, store, source } = setup();
    await importer.run({ mode: 'commit' });
    const fetchesAfterFirst = source.calls.length;
    const r2 = await importer.run({ mode: 'commit' });
    expect(store.creates).toBe(2);
    expect(outcomes(r2)['90001']).toBe('skip-exists');
    expect(outcomes(r2)['90002']).toBe('skip-exists');
    expect(source.calls.length).toBe(fetchesAfterFirst);
    expect(source.calls.filter((c) => c === '90001')).toHaveLength(1);
  });

  it('never fetches needs-review, excluded, flagged or non-listed works', async () => {
    const { importer, source } = setup();
    await importer.run({ mode: 'commit' });
    for (const id of ['90003', '90007', '90008']) {
      expect(source.calls).not.toContain(id);
    }
  });

  it('--only rejects ids that are not on the allow-list and fetches nothing', async () => {
    const { importer, source, store } = setup({ '31337': 'x' });
    const r = await importer.run({ mode: 'commit', only: '31337' });
    expect(r.items).toEqual([
      expect.objectContaining({ ebookId: '31337', outcome: 'rejected' }),
    ]);
    expect(source.calls).toEqual([]);
    expect(store.creates).toBe(0);
  });

  it('--only imports just that work', async () => {
    const { importer, store } = setup();
    const r = await importer.run({ mode: 'commit', only: '90002' });
    expect(r.items).toHaveLength(1);
    expect(store.rows.map((s) => s.sourceId)).toEqual(['90002']);
  });

  it('skip reasons are reported for needs-review entries', async () => {
    const { importer } = setup();
    const r = await importer.run({ mode: 'dry-run' });
    expect(r.items.find((i) => i.ebookId === '90007')!.reason).toBe(
      'translator unknown',
    );
    expect(r.items.find((i) => i.ebookId === '90004')!.reason).toBe(
      'no-start-marker',
    );
    expect(r.items.find((i) => i.ebookId === '90003')!.reason).toMatch(
      /dated-content/,
    );
  });

  it('upstream change sets contentChanged, reports changed, never updates or publishes', async () => {
    const { mk, store, source, cache } = setup();
    await mk().run({ mode: 'commit' });
    // a human publishes the story
    store.rows.find((s) => s.sourceId === '90001')!.isPublished = true;
    const before = { ...store.rows.find((s) => s.sourceId === '90001')! };
    source.texts['90001'] = fx('90001-0.txt').replace('small fox', 'tiny fox');
    const later = mk(new Date('2027-01-15T00:00:00Z')); // past the 30-day ttl
    const r = await later.run({ mode: 'commit' });
    expect(outcomes(r)['90001']).toBe('changed');
    expect(cache.entries.get('90001')!.contentChanged).toBe(true);
    expect(store.creates).toBe(2);
    const after = store.rows.find((s) => s.sourceId === '90001')!;
    expect(after.textContent).toBe(before.textContent);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.isPublished).toBe(true); // untouched, never auto (un)published
  });

  it('dedupes on contentHash across different ebook ids', async () => {
    const texts = TEXTS();
    const store = new MemoryStore();
    const imp = new GutenbergImporter({
      source: new FakeGutenbergSource({ ...texts, '90002': texts['90001'] }),
      cache: new FakeCache(),
      store,
      payloads: new MemoryPayloads(),
      allowList: [LIST[0], { ...LIST[0], ebookId: '90002' }],
    });
    const r = await imp.run({ mode: 'commit' });
    expect(outcomes(r)).toEqual({
      '90001': 'create',
      '90002': 'skip-duplicate',
    });
    expect(store.rows).toHaveLength(1);
  });

  it('a translator who is not provably public domain is needs-review and not fetched', async () => {
    const source = new FakeGutenbergSource(TEXTS());
    const store = new MemoryStore();
    const imp = new GutenbergImporter({
      source,
      cache: new FakeCache(),
      store,
      payloads: new MemoryPayloads(),
      allowList: [e({ translator: { name: 'Bram Sample', deathYear: 1990 } })],
      now: () => new Date('2026-11-01T00:00:00Z'),
    });
    const r = await imp.run({ mode: 'commit' });
    expect(r.items[0].outcome).toBe('needs-review');
    expect(source.calls).toEqual([]);
    expect(store.creates).toBe(0);
  });

  it('dry-run reads an existing cache entry without refetching', async () => {
    const { importer, source, cache } = setup();
    await importer.run({ mode: 'commit' });
    const calls = source.calls.length;
    const gets = cache.getOrFetchCalls;
    await importer.run({ mode: 'dry-run' });
    expect(source.calls.length).toBe(calls);
    expect(cache.getOrFetchCalls).toBe(gets);
  });

  it('dry-run ignores an expired cache entry and reads the file directly', async () => {
    const { importer, source, cache, mk } = setup({});
    await importer.run({ mode: 'commit', only: '90001' });
    expect(cache.entries.get('90001')?.httpStatus).toBe(404);
    source.texts['90001'] = fx('90001-0.txt');
    const later = mk(new Date('2027-01-15T00:00:00Z'));
    const r = await later.run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0].outcome).toBe('create');
  });

  it('dry-run still trusts a fresh cache entry', async () => {
    const { importer, source, mk } = setup({});
    await importer.run({ mode: 'commit', only: '90001' });
    source.texts['90001'] = fx('90001-0.txt');
    const r = await mk().run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0].outcome).toBe('missing-in-source');
  });

  it('a fresh cache row whose payload file is gone is re-read from the source, in dry-run and commit', async () => {
    const { importer, source, payloads, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    store.rows = [];
    payloads.files.clear();
    const dry = await importer.run({ mode: 'dry-run', only: '90001' });
    expect(dry.items[0].outcome).toBe('create');
    const commit = await importer.run({ mode: 'commit', only: '90001' });
    expect(commit.items[0].outcome).toBe('create');
    expect(store.creates).toBe(2);
    expect(source.calls.filter((c) => c === '90001').length).toBe(3);
  });

  it('commit with a missing payload revalidates the cache row instead of reading around it', async () => {
    const { importer, source, cache, payloads, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    const before = cache.entries.get('90001')?.contentHash;
    source.texts['90001'] = source.texts['90001'].replace(
      'Once upon a time',
      'Once upon a long time',
    );
    store.rows = [];
    payloads.files.clear();
    const r = await importer.run({ mode: 'commit', only: '90001' });
    expect(r.items[0].outcome).toBe('create');
    const row = cache.entries.get('90001');
    expect(row?.contentHash).not.toBe(before);
    expect(row?.contentChanged).toBe(true);
    expect(payloads.files.size).toBe(1);
  });

  it('a payload read error other than a missing file is still an error', async () => {
    const { importer, payloads } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    payloads.read = () => Promise.reject(new Error('disk on fire'));
    const r = await importer.run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0].outcome).toBe('error');
  });

  it('a soft-deleted story holding the source id is needs-review, not skip-exists', async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    store.deletedIds.add(store.rows[0].id);
    const r = await importer.run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0]).toEqual(
      expect.objectContaining({
        outcome: 'needs-review',
        reason: 'deleted story holds this source id',
      }),
    );
  });

  it('a soft-deleted story with the same content hash is needs-review, not skip-duplicate', async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    store.deletedIds.add(store.rows[0].id);
    store.rows[0].sourceId = 'other';
    const r = await importer.run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0]).toEqual(
      expect.objectContaining({
        outcome: 'needs-review',
        reason: 'deleted story holds this content hash',
      }),
    );
  });

  it("a story from another source with the same id is not this importer's story", async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    store.rows[0].sourceName = 'other-source';
    const r = await importer.run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0].outcome).toBe('skip-duplicate');
  });

  it('a live story with the same content hash wins over a deleted one', async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    store.deletedIds.add(store.rows[0].id);
    store.rows[0].sourceId = 'gone';
    store.rows.push({ ...store.rows[0], id: 'live', sourceId: 'other' });
    const r = await importer.run({ mode: 'dry-run', only: '90001' });
    expect(r.items[0]).toEqual(
      expect.objectContaining({ outcome: 'skip-duplicate', storyId: 'live' }),
    );
  });

  it('a create that collides on the source pair is skip-exists and stores one row', async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit', only: '90001' });
    store.findBySource = () => Promise.resolve(null);
    store.findByHash = () => Promise.resolve(null);
    const r = await importer.run({ mode: 'commit', only: '90001' });
    expect(r.items[0]).toEqual(
      expect.objectContaining({
        outcome: 'skip-exists',
        reason: 'created concurrently',
      }),
    );
    expect(store.rows).toHaveLength(1);
  });

  it('a work with a contents block is needs-review in dry-run and commit, and writes nothing', async () => {
    const withContents = fx('90001-0.txt').replace(
      'CHAPTER I.',
      'CONTENTS\n\nI. The Dark Wood\n\nCHAPTER I.',
    );
    const { importer, store } = setup({ '90001': withContents });
    for (const mode of ['dry-run', 'commit'] as const) {
      const r = await importer.run({ mode, only: '90001' });
      expect(r.items[0]).toEqual(
        expect.objectContaining({
          outcome: 'needs-review',
          reason: 'table-of-contents-ambiguous',
          written: false,
        }),
      );
    }
    expect(store.creates).toBe(0);
  });

  it('report summary counts outcomes', async () => {
    const { importer } = setup();
    const r = await importer.run({ mode: 'dry-run' });
    expect(r.summary.create).toBe(2);
    expect(r.summary['needs-review']).toBe(3);
    expect(r.mode).toBe('dry-run');
  });

  describe('hardening round', () => {
    it('violence flag surfaces as an editor note in dry-run and commit, and still imports', async () => {
      const { source, store } = setup();
      const imp = new GutenbergImporter({
        source,
        cache: new FakeCache(),
        store,
        payloads: new MemoryPayloads(),
        allowList: [e({ flags: ['violence'] })],
      });
      const dry = await imp.run({ mode: 'dry-run' });
      expect(dry.items[0].outcome).toBe('create');
      expect(dry.items[0].editorNotes?.join(' ')).toMatch(/violence/i);
      const c = await imp.run({ mode: 'commit' });
      expect(c.items[0].editorNotes?.join(' ')).toMatch(/violence/i);
      expect(store.rows).toHaveLength(1);
    });

    it('commit refuses unverified ebook ids before reading the source; dry-run still reports', async () => {
      const source = new FakeGutenbergSource(TEXTS());
      const store = new MemoryStore();
      const mk = () =>
        new GutenbergImporter({
          source,
          cache: new FakeCache(),
          store,
          payloads: new MemoryPayloads(),
          allowList: [e({ idVerified: false })],
        });
      const dry = await mk().run({ mode: 'dry-run' });
      expect(dry.items[0].outcome).toBe('create');
      expect(dry.items[0].editorNotes?.join(' ')).toMatch(/unverified/i);
      source.calls.length = 0;
      const c = await mk().run({ mode: 'commit' });
      expect(c.items[0].outcome).toBe('needs-review');
      expect(c.items[0].reason).toMatch(/not verified/i);
      expect(source.calls).toEqual([]);
      expect(store.creates).toBe(0);
      const ok = await mk().run({ mode: 'commit', allowUnverifiedIds: true });
      expect(ok.items[0].outcome).toBe('create');
      expect(store.creates).toBe(1);
    });

    it('oversized works go to needs-review and are not stored', async () => {
      const store = new MemoryStore();
      const imp = new GutenbergImporter({
        source: new FakeGutenbergSource(TEXTS()),
        cache: new FakeCache(),
        store,
        payloads: new MemoryPayloads(),
        allowList: [e({})],
        maxWords: 20,
      });
      const r = await imp.run({ mode: 'commit' });
      expect(r.items[0]).toMatchObject({
        outcome: 'needs-review',
        reason: 'oversized',
      });
      expect(store.creates).toBe(0);
    });
  });

  it('persists editor notes (violence, unverified id) in adaptationNotes for admin reviewers', async () => {
    const store = new MemoryStore();
    const imp = new GutenbergImporter({
      source: new FakeGutenbergSource(TEXTS()),
      cache: new FakeCache(),
      store,
      payloads: new MemoryPayloads(),
      allowList: [e({ flags: ['violence'], idVerified: false })],
    });
    await imp.run({ mode: 'commit', allowUnverifiedIds: true });
    expect(store.rows[0].adaptationNotes).toMatch(/Editor notes:.*violence/i);
    expect(store.rows[0].adaptationNotes).toMatch(/unverified/i);
  });

  it('adaptationNotes has no editor-notes section when there are none', async () => {
    const { importer, store } = setup();
    await importer.run({ mode: 'commit' });
    expect(store.rows[0].adaptationNotes).not.toMatch(/Editor notes/);
  });
});
