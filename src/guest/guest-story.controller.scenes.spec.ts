import { GuestStoryController } from './guest-story.controller';

const SID = '123e4567-e89b-42d3-a456-426614174000';
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
  images: [{ url: 'https://old', caption: null }],
  branches: [],
  categories: [],
  themes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GuestStoryController.getStoryForGuest - scene illustrations', () => {
  const guestSession = {
    maskSessionId: (s?: string) => s,
    recordNewStoryAccess: jest.fn(),
  };
  const storyService = { getStoryById: jest.fn() };
  const scenes = { getReadExtras: jest.fn() };
  const events = { emit: jest.fn().mockReturnValue(true) };
  let controller: GuestStoryController;

  beforeEach(() => {
    jest.clearAllMocks();
    storyService.getStoryById.mockResolvedValue(STORY);
    guestSession.recordNewStoryAccess.mockResolvedValue({ recorded: true });
    controller = new GuestStoryController(
      guestSession as never,
      storyService as never,
      events as never,
      scenes as never,
    );
  });

  it('adds pages and approved scenes, keeping existing fields', async () => {
    const extras = {
      pages: ['Hello there.'],
      scenes: [
        { index: 0, startPage: 0, endPage: 0, imageUrl: 'https://s0.webp' },
      ],
    };
    scenes.getReadExtras.mockResolvedValue(extras);

    const res = await controller.getStoryForGuest('st1', SID);

    expect(scenes.getReadExtras).toHaveBeenCalledWith('st1', 'Hello there.');
    expect(res).toMatchObject({
      id: 'st1',
      coverImageUrl: 'https://cover',
      textContent: 'Hello there.',
      images: STORY.images,
      ...extras,
    });
  });
});
