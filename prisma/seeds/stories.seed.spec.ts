import * as fs from 'fs';
import { seedStories } from './stories.seed';
import { contentHashOf } from '../../src/shared/utils/content-hash.util';

jest.mock('fs');

const logger = { log: jest.fn(), error: jest.fn(), success: jest.fn() };

const base = (over: Record<string, unknown> = {}) => ({
  title: 'A Title',
  description: 'd',
  language: 'en',
  coverImageUrl: 'c',
  content: 'Once upon a time.',
  category: 'Fables',
  theme: 'Kindness',
  questions: [],
  ...over,
});

function setup(stories: any[], existing: any[] = []) {
  (fs.existsSync as jest.Mock).mockReturnValue(true);
  (fs.readdirSync as jest.Mock).mockReturnValue(['stories.json']);
  (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(stories));
  const create = jest.fn().mockResolvedValue({});
  const tx = { story: { create } };
  const prisma: any = {
    story: { findMany: jest.fn().mockResolvedValue(existing) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  return { prisma, create };
}

describe('seedStories provenance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists optional provenance fields when provided', async () => {
    const { prisma, create } = setup([
      base({
        sourceName: 'bookdash',
        sourceId: 'bd-1',
        sourceUrl: 'https://bookdash.org/bd-1',
        licenseCode: 'CC-BY-4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        authorName: 'A. Author',
        attributionText: 'Story by A. Author, CC BY 4.0',
        adaptationNotes: 'Shortened',
        importedAt: '2026-10-31T00:00:00.000Z',
      }),
    ]);
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      sourceName: 'bookdash',
      sourceId: 'bd-1',
      sourceUrl: 'https://bookdash.org/bd-1',
      licenseCode: 'CC-BY-4.0',
      authorName: 'A. Author',
      attributionText: 'Story by A. Author, CC BY 4.0',
      adaptationNotes: 'Shortened',
    });
    expect(data.importedAt).toEqual(new Date('2026-10-31T00:00:00.000Z'));
    // contentHash is derived from the normalised text when not supplied
    expect(data.contentHash).toBe(contentHashOf('Once upon a time.'));
  });

  it('leaves provenance null for plain curated stories (no behaviour change)', async () => {
    const { prisma, create } = setup([base()]);
    await seedStories({ prisma, logger });
    const data = create.mock.calls[0][0].data;
    expect(data.sourceName).toBeNull();
    expect(data.sourceId).toBeNull();
    expect(data.licenseCode).toBeNull();
    expect(data.attributionText).toBeNull();
    expect(data.importedAt).toBeNull();
    expect(data.contentHash).toBeNull();
  });

  it('still dedupes by title', async () => {
    const { prisma, create } = setup(
      [base()],
      [
        {
          title: 'a title',
          sourceName: null,
          sourceId: null,
          contentHash: null,
        },
      ],
    );
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('dedupes by (sourceName, sourceId) even when the title differs', async () => {
    const { prisma, create } = setup(
      [base({ title: 'Different', sourceName: 'gutenberg', sourceId: '11' })],
      [
        {
          title: 'Old',
          sourceName: 'gutenberg',
          sourceId: '11',
          contentHash: null,
        },
      ],
    );
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not treat the same sourceId under another source as a duplicate', async () => {
    const { prisma, create } = setup(
      [base({ title: 'Different', sourceName: 'bookdash', sourceId: '11' })],
      [
        {
          title: 'Old',
          sourceName: 'gutenberg',
          sourceId: '11',
          contentHash: null,
        },
      ],
    );
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('dedupes by contentHash when the text matches an existing story', async () => {
    const hash = contentHashOf('Once upon a time.');
    const { prisma, create } = setup(
      [
        base({
          title: 'Renamed copy',
          sourceName: 'x',
          sourceId: '2',
          content: 'Once  upon a\r\ntime.',
        }),
      ],
      [
        {
          title: 'Original',
          sourceName: null,
          sourceId: null,
          contentHash: hash,
        },
      ],
    );
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('dedupes within one batch on (sourceName, sourceId) and contentHash', async () => {
    const { prisma, create } = setup([
      base({ title: 'One', sourceName: 'g', sourceId: '1', content: 'alpha' }),
      base({ title: 'Two', sourceName: 'g', sourceId: '1', content: 'beta' }),
      base({
        title: 'Three',
        content: 'gamma',
        contentHash: contentHashOf('gamma'),
      }),
      base({
        title: 'Four',
        content: 'gamma',
        contentHash: contentHashOf('gamma'),
      }),
    ]);
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('dedupes a story with a supplied correct hash against one whose hash is computed', async () => {
    const { prisma, create } = setup([
      base({
        title: 'Imported',
        sourceName: 'x',
        sourceId: '1',
        content: 'delta  text',
      }),
      base({
        title: 'Curated copy',
        content: 'delta text',
        contentHash: contentHashOf('delta text'),
      }),
    ]);
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a supplied contentHash that does not match the normalised content', async () => {
    const { prisma, create } = setup([
      base({ title: 'Bad', content: 'epsilon', contentHash: 'gamma-hash' }),
    ]);
    const r = await seedStories({ prisma, logger });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/contentHash.*does not match/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not hash-dedupe plain curated stories (no behaviour change)', async () => {
    const { prisma, create } = setup([
      base({ title: 'P1', content: 'same text' }),
      base({ title: 'P2', content: 'same text' }),
    ]);
    const r = await seedStories({ prisma, logger });
    expect(r.count).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('selects only the dedupe columns from existing stories', async () => {
    const { prisma } = setup([base()]);
    await seedStories({ prisma, logger });
    expect(prisma.story.findMany).toHaveBeenCalledWith({
      select: {
        title: true,
        sourceName: true,
        sourceId: true,
        contentHash: true,
      },
    });
  });
});
