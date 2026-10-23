import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import {
  ADMIN_ENGAGEMENT_REPOSITORY,
  ADMIN_STORY_REPOSITORY,
} from './repositories';

describe('AdminReadingAnalyticsService', () => {
  let service: AdminReadingAnalyticsService;
  const getStoryReaderStats = jest.fn();
  const getStoryReaderStatsForStory = jest.fn();
  const getStoryReaderTrend = jest.fn();
  const getStoryReaders = jest.fn();
  const findTitlesByIds = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminReadingAnalyticsService,
        {
          provide: ADMIN_ENGAGEMENT_REPOSITORY,
          useValue: {
            getStoryReaderStats,
            getStoryReaderStatsForStory,
            getStoryReaderTrend,
            getStoryReaders,
          },
        },
        { provide: ADMIN_STORY_REPOSITORY, useValue: { findTitlesByIds } },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(AdminReadingAnalyticsService);
  });

  it('suppresses readerCount to null for stories under the 5-reader threshold', async () => {
    getStoryReaderStats.mockResolvedValue([
      {
        storyId: 's1',
        distinctReaders: 4,
        completedCount: 1,
        avgTimeSpentSeconds: 10,
      },
      {
        storyId: 's2',
        distinctReaders: 5,
        completedCount: 2,
        avgTimeSpentSeconds: 20,
      },
    ]);
    findTitlesByIds.mockResolvedValue([
      { id: 's1', title: 'Below Threshold' },
      { id: 's2', title: 'At Threshold' },
    ]);

    const result = await service.getTopStories({ range: 30 });

    const below = result.find((r) => r.storyId === 's1');
    const at = result.find((r) => r.storyId === 's2');
    expect(below!.readerCount).toBeNull();
    expect(at!.readerCount).toBe(5);
  });

  it('sorts suppressed rows to the bottom regardless of their real count', async () => {
    getStoryReaderStats.mockResolvedValue([
      {
        storyId: 's1',
        distinctReaders: 4,
        completedCount: 0,
        avgTimeSpentSeconds: 0,
      },
      {
        storyId: 's2',
        distinctReaders: 50,
        completedCount: 0,
        avgTimeSpentSeconds: 0,
      },
      {
        storyId: 's3',
        distinctReaders: 1,
        completedCount: 0,
        avgTimeSpentSeconds: 0,
      },
    ]);
    findTitlesByIds.mockResolvedValue([
      { id: 's1', title: 'A' },
      { id: 's2', title: 'B' },
      { id: 's3', title: 'C' },
    ]);

    const result = await service.getTopStories({ range: 30 });

    expect(result[0].storyId).toBe('s2'); // only non-suppressed row, must be first
    expect(result.slice(1).map((r) => r.readerCount)).toEqual([null, null]);
  });

  it('suppresses the reader list on story detail when total distinct readers is under 5', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 3,
      completedCount: 1,
      avgTimeSpentSeconds: 15,
    });
    findTitlesByIds.mockResolvedValue([{ id: 's1', title: 'Story' }]);
    getStoryReaderTrend.mockResolvedValue([]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail!.readersSuppressed).toBe(true);
    expect(detail!.readers).toEqual([]);
    expect(detail!.trend).toEqual([]);
    expect(getStoryReaders).not.toHaveBeenCalled();
    expect(getStoryReaderTrend).not.toHaveBeenCalled();
  });

  it('includes the real reader list on story detail at/above the threshold', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 5,
      completedCount: 1,
      avgTimeSpentSeconds: 15,
    });
    findTitlesByIds.mockResolvedValue([{ id: 's1', title: 'Story' }]);
    getStoryReaderTrend.mockResolvedValue([]);
    getStoryReaders.mockResolvedValue([
      {
        readerId: 'k1',
        readerType: 'kid',
        displayName: 'Kid One',
        lastAccessed: new Date(),
      },
    ]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail!.readersSuppressed).toBe(false);
    expect(detail!.readers).toHaveLength(1);
  });

  it('returns null from getStoryDetail when the story has no reading activity', async () => {
    getStoryReaderStatsForStory.mockResolvedValue(null);

    const detail = await service.getStoryDetail('missing', { range: 30 });

    expect(detail).toBeNull();
  });

  it('suppresses the standalone trend endpoint when the story is under the 5-reader threshold', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 4,
      completedCount: 1,
      avgTimeSpentSeconds: 10,
    });

    const trend = await service.getStoryTrend('s1', { range: 30 });

    expect(trend).toEqual([]);
    expect(getStoryReaderTrend).not.toHaveBeenCalled();
  });

  it('suppresses the standalone trend endpoint when the story has no reading activity', async () => {
    getStoryReaderStatsForStory.mockResolvedValue(null);

    const trend = await service.getStoryTrend('missing', { range: 30 });

    expect(trend).toEqual([]);
    expect(getStoryReaderTrend).not.toHaveBeenCalled();
  });

  it('returns the real trend from the standalone endpoint at/above the threshold', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 5,
      completedCount: 1,
      avgTimeSpentSeconds: 10,
    });
    getStoryReaderTrend.mockResolvedValue([
      { date: '2026-10-01', distinctReaders: 2, completions: 1 },
    ]);

    const trend = await service.getStoryTrend('s1', { range: 30 });

    expect(trend).toHaveLength(1);
    expect(getStoryReaderTrend).toHaveBeenCalledWith('s1', expect.anything());
  });
});
