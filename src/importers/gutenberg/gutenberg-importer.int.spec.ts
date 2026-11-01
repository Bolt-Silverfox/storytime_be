import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceCacheService } from '@/source-cache/source-cache.service';
import { GutenbergImporter } from './gutenberg-importer';
import {
  FsPayloadStore,
  PrismaStoryStore,
  SourceCachePortImpl,
} from './gutenberg-importer.adapters';
import { FilesystemGutenbergSource } from './gutenberg-source';
import { AllowListEntry } from './allowlist.types';
import { GUTENBERG_REFERENCE } from './gutenberg-text';

/** Real Postgres, real SourceCacheService. No network. Skipped without DATABASE_URL. */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const FX = path.resolve('test/fixtures/gutenberg');
const tag = `gint${Date.now()}`;

const entry = (over: Partial<AllowListEntry>): AllowListEntry => ({
  ebookId: '90001',
  title: 'The Little Lantern Fox',
  authorName: 'Ada Example',
  translator: { name: 'Bram Sample', deathYear: 1900 },
  firstPublished: 1890,
  status: 'approved',
  flags: [],
  ageMin: 4,
  ageMax: 7,
  categories: [`${tag}-cat`, `${tag}-missing`],
  themes: [`${tag}-theme`],
  description: 'A fox borrows a light.',
  expect: { title: 'Lantern Fox', author: 'Example' },
  pdJustification: 'invented',
  idVerified: true,
  ...over,
});
const LIST = [
  entry({}),
  entry({
    ebookId: '90002',
    title: 'The Moon Spoon',
    authorName: 'Cy Invented',
    translator: undefined,
    illustrator: 'Dot Drawn',
    categories: [],
    themes: [],
    expect: { title: 'Moon Spoon', author: 'Invented' },
  }),
];

describeDb('GutenbergImporter (real Postgres)', () => {
  let prisma: PrismaService;
  let srcDir: string;
  let cacheDir: string;
  let reads: string[];

  const build = (at = new Date()) => {
    const fsSource = new FilesystemGutenbergSource(srcDir);
    const source = {
      fetch: (id: string, signal: AbortSignal) => {
        reads.push(id);
        return fsSource.fetch(id, signal);
      },
    };
    return new GutenbergImporter({
      source,
      cache: new SourceCachePortImpl(new SourceCacheService(prisma)),
      store: new PrismaStoryStore(prisma),
      payloads: new FsPayloadStore(cacheDir),
      allowList: LIST,
      now: () => at,
    });
  };

  const clean = async () => {
    await prisma.story.deleteMany({
      where: { sourceName: 'gutenberg', sourceId: { in: ['90001', '90002'] } },
    });
    await prisma.sourceCache.deleteMany({
      where: { sourceName: 'gutenberg', sourceId: { in: ['90001', '90002'] } },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.category.create({ data: { name: `${tag}-cat` } });
    await prisma.theme.create({ data: { name: `${tag}-theme` } });
  });
  beforeEach(async () => {
    await clean();
    reads = [];
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsrc-'));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcache-'));
    fs.copyFileSync(
      path.join(FX, '90001-0.txt'),
      path.join(srcDir, '90001-0.txt'),
    );
    fs.copyFileSync(path.join(FX, '90002.txt'), path.join(srcDir, '90002.txt'));
  });
  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await clean();
    await prisma.category.deleteMany({ where: { name: `${tag}-cat` } });
    await prisma.theme.deleteMany({ where: { name: `${tag}-theme` } });
    await prisma.$disconnect();
  });

  const stories = () =>
    prisma.story.findMany({
      where: { sourceName: 'gutenberg', sourceId: { in: ['90001', '90002'] } },
      omit: {
        sourceId: false,
        contentHash: false,
        adaptationNotes: false,
        importedAt: false,
      },
      include: { categories: true, themes: true },
    });

  it('dry-run writes nothing: no story, no cache row, no payload file', async () => {
    const r = await build().run({ mode: 'dry-run' });
    expect(r.items.map((i) => i.outcome)).toEqual(['create', 'create']);
    expect(await stories()).toHaveLength(0);
    expect(
      await prisma.sourceCache.count({
        where: {
          sourceName: 'gutenberg',
          sourceId: { in: ['90001', '90002'] },
        },
      }),
    ).toBe(0);
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });

  it('commit creates unpublished stories with provenance and mapped taxonomy', async () => {
    const r = await build().run({ mode: 'commit' });
    expect(r.summary.create).toBe(2);
    const rows = await stories();
    expect(rows).toHaveLength(2);
    for (const s of rows) {
      expect(s.isPublished).toBe(false);
      expect(s.licenseCode).toBe('PD-US');
      expect(s.sourceName).toBe('gutenberg');
      expect(s.importedAt).toBeInstanceOf(Date);
      expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
      for (const f of [
        s.title,
        s.description,
        s.textContent,
        s.attributionText,
        s.authorName,
        s.adaptationNotes,
      ]) {
        expect(f).not.toMatch(GUTENBERG_REFERENCE);
      }
    }
    const fox = rows.find((s) => s.sourceId === '90001')!;
    expect(fox.categories.map((c) => c.name)).toEqual([`${tag}-cat`]);
    expect(fox.themes).toHaveLength(1);
    expect(r.items[0].unmapped?.categories).toEqual([`${tag}-missing`]);
    const cats = await prisma.category.count({
      where: { name: `${tag}-missing` },
    });
    expect(cats).toBe(0); // never created silently
  });

  it('re-run creates 0 and reads each work from the source exactly once', async () => {
    await build().run({ mode: 'commit' });
    const r2 = await build().run({ mode: 'commit' });
    expect(r2.summary['skip-exists']).toBe(2);
    expect(await stories()).toHaveLength(2);
    expect(reads.sort()).toEqual(['90001', '90002']);
  });

  it('changed upstream text sets contentChanged, leaves the story and its publish state alone', async () => {
    await build().run({ mode: 'commit' });
    await prisma.story.updateMany({
      where: { sourceName: 'gutenberg', sourceId: '90001' },
      data: { isPublished: true },
    });
    const before = (await stories()).find((s) => s.sourceId === '90001')!;
    const p = path.join(srcDir, '90001-0.txt');
    fs.writeFileSync(
      p,
      fs.readFileSync(p, 'utf8').replace('small fox', 'tiny fox'),
    );
    const later = new Date(Date.now() + 40 * 86_400_000); // past the 30-day cache window
    const r = await build(later).run({ mode: 'commit' });
    expect(r.items.find((i) => i.ebookId === '90001')!.outcome).toBe('changed');
    const cache = await prisma.sourceCache.findUnique({
      where: {
        sourceName_sourceId: { sourceName: 'gutenberg', sourceId: '90001' },
      },
    });
    expect(cache?.contentChanged).toBe(true);
    expect(cache?.previousContentHash).toBe(before.contentHash);
    const after = (await stories()).find((s) => s.sourceId === '90001')!;
    expect(after.textContent).toBe(before.textContent);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.isPublished).toBe(true);
    expect(await stories()).toHaveLength(2);
  });
});
