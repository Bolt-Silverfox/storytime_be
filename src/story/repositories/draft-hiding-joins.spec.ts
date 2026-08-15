import { PrismaStoryRepository } from './prisma-story.repository';
import { PrismaStoryFavoriteRepository } from './prisma-story-favorite.repository';
import { PrismaStoryDownloadRepository } from './prisma-story-download.repository';
import { PrismaGuestRepository } from '../../guest/repositories/prisma-guest.repository';

// Caveat A: library / history / progress joins that return story objects must
// hide stories that have since been unpublished (draft). Each of these read
// paths must carry a `story: { isPublished: true }` (or, for direct story
// reads, `isPublished: true`) predicate in its parent `where`.

const whereOf = (mockFn: jest.Mock) => mockFn.mock.calls[0][0].where;

describe('draft-hiding on library/history joins', () => {
  describe('PrismaStoryRepository progress joins', () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaStoryRepository({
      storyProgress: { findMany },
      userStoryProgress: { findMany },
    } as never);

    beforeEach(() => findMany.mockClear());

    it('findContinueReadingProgress filters story.isPublished', async () => {
      await repo.findContinueReadingProgress('kid1');
      expect(whereOf(findMany).story).toEqual({ isPublished: true });
    });

    it('findCompletedProgress filters story.isPublished', async () => {
      await repo.findCompletedProgress('kid1');
      expect(whereOf(findMany).story).toEqual({ isPublished: true });
    });

    it('findUserContinueReadingProgress filters story.isPublished', async () => {
      await repo.findUserContinueReadingProgress('user1');
      expect(whereOf(findMany).story).toEqual({ isPublished: true });
    });

    it('findUserCompletedProgress filters story.isPublished', async () => {
      await repo.findUserCompletedProgress('user1');
      expect(whereOf(findMany).story).toEqual({ isPublished: true });
    });
  });

  it('favorites join filters story.isPublished', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaStoryFavoriteRepository({
      favorite: { findMany },
    } as never);
    await repo.findFavoritesByKidId('kid1');
    expect(whereOf(findMany).story).toEqual({
      isDeleted: false,
      isPublished: true,
    });
  });

  it('downloads join filters story.isPublished', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaStoryDownloadRepository({
      downloadedStory: { findMany },
    } as never);
    await repo.findDownloadsByKidId('kid1');
    expect(whereOf(findMany).story).toEqual({ isPublished: true });
  });

  describe('guest reads', () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const storyFindMany = jest.fn().mockResolvedValue([]);
    const progressFindMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaGuestRepository({
      story: { findFirst, findMany: storyFindMany },
      userStoryProgress: { findMany: progressFindMany },
    } as never);

    it('findStoryDetail requires isPublished', async () => {
      await repo.findStoryDetail('s1');
      expect(findFirst.mock.calls[0][0].where).toMatchObject({
        isPublished: true,
      });
    });

    it('findStoryDetailsByIds requires isPublished', async () => {
      await repo.findStoryDetailsByIds(['s1']);
      expect(storyFindMany.mock.calls[0][0].where).toMatchObject({
        isPublished: true,
      });
    });

    it('findUserReadingHistory filters story.isPublished', async () => {
      await repo.findUserReadingHistory('user1');
      expect(progressFindMany.mock.calls[0][0].where.story).toEqual({
        isPublished: true,
      });
    });
  });
});
