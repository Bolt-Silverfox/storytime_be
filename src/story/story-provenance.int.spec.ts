import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Real-Postgres checks for the provenance columns/indexes added by migration
 * 20261031000001_add_story_provenance_and_source_cache. Skipped w/o DATABASE_URL.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('story provenance schema (real Postgres)', () => {
  const prisma = new PrismaClient();
  const tag = `prov_${Date.now()}`;
  const base = {
    title: 't',
    description: 'd',
    language: 'en',
    coverImageUrl: '',
    audioUrl: '',
    isInteractive: false,
    ageMin: 0,
    ageMax: 9,
  };

  afterEach(async () => {
    await prisma.story.deleteMany({ where: { sourceName: tag } });
    await prisma.story.deleteMany({ where: { title: tag } });
  });
  afterAll(() => prisma.$disconnect());

  it('existing-style stories have null provenance and stay published', async () => {
    const s = await prisma.story.create({ data: { ...base, title: tag } });
    expect(s).toMatchObject({
      sourceName: null,
      sourceId: null,
      sourceUrl: null,
      licenseCode: null,
      licenseUrl: null,
      authorName: null,
      attributionText: null,
      adaptationNotes: null,
      importedAt: null,
      contentHash: null,
      isPublished: true,
    });
  });

  it('rejects a duplicate (sourceName, sourceId) pair', async () => {
    const data = { ...base, sourceName: tag, sourceId: '42' };
    await prisma.story.create({ data });
    await expect(prisma.story.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('allows many stories with NULL source ids (non-imported)', async () => {
    await prisma.story.create({ data: { ...base, title: tag } });
    await prisma.story.create({ data: { ...base, title: tag } });
    await prisma.story.create({
      data: { ...base, title: tag, sourceName: tag },
    });
    await prisma.story.create({
      data: { ...base, title: tag, sourceName: tag },
    });
  });

  it('has an index on contentHash', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'stories' AND indexdef ILIKE '%"contentHash"%'`;
    expect(rows.length).toBeGreaterThan(0);
  });

  describe('PrismaService hides internal provenance by default', () => {
    const svc = new PrismaService();
    const full = {
      ...base,
      title: tag,
      sourceName: tag,
      sourceId: 'secret-id',
      sourceUrl: 'https://example.org/book',
      licenseCode: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      authorName: 'A. Author',
      attributionText: 'Story by A. Author, CC BY 4.0',
      adaptationNotes: 'Shortened; simplified',
      importedAt: new Date(),
      contentHash: 'a'.repeat(64),
    };
    afterAll(() => svc.$disconnect());

    it('returns credit fields but not sourceId/contentHash/adaptationNotes/importedAt', async () => {
      const created = await prisma.story.create({ data: full });
      const read: any = await svc.story.findUnique({
        where: { id: created.id },
      });
      expect(read.attributionText).toBe(full.attributionText);
      expect(read.authorName).toBe(full.authorName);
      expect(read.licenseCode).toBe('CC-BY-4.0');
      expect(read.licenseUrl).toBe(full.licenseUrl);
      expect(read.sourceName).toBe(tag);
      expect(read.sourceUrl).toBe(full.sourceUrl);
      expect(read).not.toHaveProperty('sourceId');
      expect(read).not.toHaveProperty('contentHash');
      expect(read).not.toHaveProperty('adaptationNotes');
      expect(read).not.toHaveProperty('importedAt');
    });

    it('also hides them on findMany and on nested story includes', async () => {
      const created = await prisma.story.create({ data: full });
      const list: any[] = await svc.story.findMany({
        where: { id: created.id },
      });
      expect(list[0]).not.toHaveProperty('sourceId');
      const cat = await svc.category.create({
        data: {
          name: `${tag}-c`,
          description: 'x',
          stories: { connect: { id: created.id } },
        },
        include: { stories: true },
      });
      expect(cat.stories[0] as any).not.toHaveProperty('contentHash');
      await svc.category.delete({ where: { id: cat.id } });
    });

    it('lets a caller opt in explicitly (admin detail)', async () => {
      const created = await prisma.story.create({ data: full });
      const read: any = await svc.story.findUnique({
        where: { id: created.id },
        omit: { adaptationNotes: false, importedAt: false },
      });
      expect(read.adaptationNotes).toBe(full.adaptationNotes);
      expect(read.importedAt).toBeInstanceOf(Date);
      expect(read).not.toHaveProperty('sourceId');
    });
  });
});
