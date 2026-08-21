import { StoryFeedService } from './story-feed.service';
import { StoryService } from './story.service';
import { IStoryRepository } from './repositories/story.repository.interface';

describe('public read paths hide drafts', () => {
  it('getStories base where includes isPublished: true (StoryFeedService chokepoint)', async () => {
    const findManyStoriesRaw = jest.fn().mockResolvedValue([]);
    const countStoriesRaw = jest.fn().mockResolvedValue(0);

    const storyRepository: Partial<IStoryRepository> = {
      findManyStoriesRaw,
      countStoriesRaw,
    };

    const svc = new StoryFeedService(
      storyRepository as IStoryRepository,
      {} as never, // cacheManager
      {} as never, // guestSessionService
    );

    await svc.getStories({});

    expect(findManyStoriesRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true }),
      }),
    );
    expect(countStoriesRaw).toHaveBeenCalledWith(
      expect.objectContaining({ isPublished: true }),
    );
  });

  it('getStoryById filters isPublished: true (StoryService chokepoint)', async () => {
    const findUniqueStoryRaw = jest
      .fn()
      .mockResolvedValue({ id: 's1', isPublished: true });

    const storyRepository: Partial<IStoryRepository> = {
      findUniqueStoryRaw,
    };

    const svc = new StoryService(
      storyRepository as IStoryRepository,
      {} as never, // cacheManager
      {} as never, // uploadService
      {} as never, // storyGenerationService
      {} as never, // storyFavoriteService
      {} as never, // storyDownloadService
      {} as never, // storyPathService
      {} as never, // storyMetadataService
      {} as never, // storyProgressService
      {} as never, // storyRecommendationService
      {} as never, // dailyChallengeService
      {} as never, // storyFeedService
      {} as never, // notificationService
    );

    await svc.getStoryById('s1');

    expect(findUniqueStoryRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 's1', isPublished: true }),
      }),
    );
  });
});
