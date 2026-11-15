import { StoryReadController } from './story-read.controller';
import type { RequestWithStoryAccess } from '@/shared/guards/story-access.guard';

const STORY = {
  id: 'st1',
  title: 'Title',
  description: 'd',
  language: 'english',
  coverImageUrl: 'https://cover',
  audioUrl: '',
  textContent: 'Hello there.',
  isInteractive: false,
  ageMin: 3,
  ageMax: 8,
  images: [{ id: 'i1', url: 'https://old', caption: null }],
  branches: [],
  categories: [],
  themes: [],
  questions: [],
};

describe('StoryReadController - scene illustrations', () => {
  const storyService = { getStoryById: jest.fn() };
  const quota = { recordNewStoryAccess: jest.fn() };
  const scenes = { getReadExtras: jest.fn() };
  const req = {
    authUserData: { userId: 'u1' },
    storyAccessResult: { reason: 'already_read' },
  } as unknown as RequestWithStoryAccess;
  let controller: StoryReadController;

  beforeEach(() => {
    jest.resetAllMocks();
    storyService.getStoryById.mockResolvedValue(STORY);
    controller = new StoryReadController(
      storyService as never,
      quota as never,
      scenes as never,
    );
  });

  it('adds pages and scenes and leaves every existing field unchanged', async () => {
    const extras = {
      pages: ['Hello there.'],
      pageCount: 1,
      scenes: [
        { index: 0, startPage: 0, endPage: 0, imageUrl: 'https://s0.webp' },
      ],
    };
    scenes.getReadExtras.mockResolvedValue(extras);

    const res = await controller.getStoryById('st1', req);

    expect(scenes.getReadExtras).toHaveBeenCalledWith('st1', 'Hello there.');
    expect(res).toEqual({ ...STORY, ...extras });
    expect(res.pageCount).toBe(1);
    expect(res.coverImageUrl).toBe('https://cover');
    expect(res.images).toEqual(STORY.images);
  });

  it('serves an empty scenes array when nothing is approved', async () => {
    scenes.getReadExtras.mockResolvedValue({
      pages: ['Hello there.'],
      scenes: [],
    });
    const res = await controller.getStoryById('st1', req);
    expect(res.scenes).toEqual([]);
  });
});
