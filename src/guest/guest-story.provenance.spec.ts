import { GuestStoryController } from './guest-story.controller';

const fullStory = {
  id: 's1',
  title: 'T',
  description: 'D',
  language: 'en',
  categories: [],
  themes: [],
  coverImageUrl: 'c',
  audioUrl: 'a',
  textContent: 'text',
  isInteractive: false,
  ageMin: 2,
  ageMax: 8,
  images: [],
  branches: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  sourceName: 'bookdash',
  sourceUrl: 'https://bookdash.org/x',
  licenseCode: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  authorName: 'A. Author',
  attributionText: 'Story by A. Author. CC BY 4.0.',
  // must never reach the client:
  sourceId: 'internal-id',
  contentHash: 'deadbeef',
  adaptationNotes: 'internal notes',
  importedAt: new Date(),
};

describe('GuestStoryController credit fields', () => {
  const build = (story: any) => {
    const storyService = { getStoryById: jest.fn().mockResolvedValue(story) };
    const guestSessionService = {
      maskSessionId: (s: string) => s,
      recordNewStoryAccess: jest
        .fn()
        .mockResolvedValue({ recorded: true, reason: 'new' }),
    };
    const eventEmitter = { emit: jest.fn().mockReturnValue(true) };
    return new GuestStoryController(
      guestSessionService as any,
      storyService as any,
      eventEmitter as any,
      {
        getReadExtras: jest
          .fn()
          .mockResolvedValue({ pages: [], pageCount: 0, scenes: [] }),
      } as any,
    );
  };
  const sid = '11111111-1111-4111-8111-111111111111';

  it('exposes the six credit fields', async () => {
    const res: any = await build(fullStory).getStoryForGuest('s1', sid);
    expect(res).toMatchObject({
      attributionText: 'Story by A. Author. CC BY 4.0.',
      authorName: 'A. Author',
      licenseCode: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceName: 'bookdash',
      sourceUrl: 'https://bookdash.org/x',
    });
  });

  it('never exposes sourceId, contentHash, adaptationNotes or importedAt', async () => {
    const res: any = await build(fullStory).getStoryForGuest('s1', sid);
    for (const k of [
      'sourceId',
      'contentHash',
      'adaptationNotes',
      'importedAt',
    ]) {
      expect(res).not.toHaveProperty(k);
    }
  });

  it('returns null credit fields for stories without provenance', async () => {
    const plain: Record<string, unknown> = { ...fullStory };
    for (const k of [
      'sourceName',
      'sourceUrl',
      'licenseCode',
      'licenseUrl',
      'authorName',
      'attributionText',
    ])
      delete plain[k];
    const res: any = await build(plain).getStoryForGuest('s1', sid);
    for (const k of [
      'attributionText',
      'authorName',
      'licenseCode',
      'licenseUrl',
      'sourceName',
      'sourceUrl',
    ]) {
      expect(res[k]).toBeNull();
    }
  });
});
