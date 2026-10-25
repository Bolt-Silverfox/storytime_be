import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  const findStoryBasicById = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: story exists, so detail/trend tests that aren't about the
    // existence check don't each have to stub this individually.
    findStoryBasicById.mockResolvedValue({ id: 's1', title: 'Story' });
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
        {
          provide: ADMIN_STORY_REPOSITORY,
          useValue: { findTitlesByIds, findStoryBasicById },
        },
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

  it('suppresses completionRate to null for a below-threshold story on top-stories (does not leak the suppressed count via the fraction)', async () => {
    getStoryReaderStats.mockResolvedValue([
      {
        storyId: 's1',
        distinctReaders: 4,
        completedCount: 1,
        avgTimeSpentSeconds: 10,
      },
    ]);
    findTitlesByIds.mockResolvedValue([{ id: 's1', title: 'Below Threshold' }]);

    const result = await service.getTopStories({ range: 30 });

    expect(result[0].completionRate).toBeNull();
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

  it('paginates top stories after suppression, with meta, keeping suppressed rows null', async () => {
    const stats = [12, 9, 8, 7, 6, 3].map((n, i) => ({
      storyId: `s${i}`,
      distinctReaders: n,
      completedCount: 1,
      avgTimeSpentSeconds: 0,
    }));
    getStoryReaderStats.mockResolvedValue(stats);
    findTitlesByIds.mockResolvedValue(
      stats.map((s) => ({ id: s.storyId, title: s.storyId })),
    );

    const p1 = await service.getTopStoriesPage({
      range: 30,
      page: 1,
      limit: 4,
    });
    const p2 = await service.getTopStoriesPage({
      range: 30,
      page: 2,
      limit: 4,
    });

    expect(p1.data.map((r) => r.storyId)).toEqual(['s0', 's1', 's2', 's3']);
    expect(p1.meta).toEqual({ total: 6, page: 1, limit: 4, totalPages: 2 });
    expect(p2.data.map((r) => r.storyId)).toEqual(['s4', 's5']);
    expect(p2.data[1].readerCount).toBeNull();
    expect(p2.data[1].completionRate).toBeNull();
  });

  it('returns an empty page with totalPages 0 when there is no activity', async () => {
    getStoryReaderStats.mockResolvedValue([]);
    findTitlesByIds.mockResolvedValue([]);
    const r = await service.getTopStoriesPage({ range: 30 });
    expect(r).toEqual({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });
  });

  it('suppresses the reader list on story detail when total distinct readers is under 5', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 3,
      completedCount: 1,
      avgTimeSpentSeconds: 15,
    });
    getStoryReaderTrend.mockResolvedValue([]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail.readersSuppressed).toBe(true);
    expect(detail.readers).toEqual([]);
    expect(detail.trend).toEqual([]);
    expect(getStoryReaders).not.toHaveBeenCalled();
    expect(getStoryReaderTrend).not.toHaveBeenCalled();
  });

  it('suppresses completionRate and avgTimeSpentSeconds on story detail when under the 5-reader threshold (does not leak the suppressed count via the fraction)', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 4,
      completedCount: 1,
      avgTimeSpentSeconds: 42,
    });

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail.completionRate).toBeNull();
    expect(detail.avgTimeSpentSeconds).toBeNull();
  });

  it('includes the real reader list on story detail at/above the threshold', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 5,
      completedCount: 1,
      avgTimeSpentSeconds: 15,
    });
    getStoryReaderTrend.mockResolvedValue([]);
    getStoryReaders.mockResolvedValue([
      {
        readerId: 'k1',
        readerType: 'kid',
        displayName: 'Kid One',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k2',
        readerType: 'kid',
        displayName: 'Kid Two',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k3',
        readerType: 'kid',
        displayName: 'Kid Three',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k4',
        readerType: 'kid',
        displayName: 'Kid Four',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k5',
        readerType: 'kid',
        displayName: 'Kid Five',
        lastAccessed: new Date(),
      },
    ]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail.readersSuppressed).toBe(false);
    expect(detail.readers).toHaveLength(5);
    expect(detail.completionRate).toBe(0.2);
    expect(detail.avgTimeSpentSeconds).toBe(15);
  });

  it('throws NotFoundException from getStoryDetail when the story does not exist', async () => {
    findStoryBasicById.mockResolvedValue(null);

    await expect(
      service.getStoryDetail('missing', { range: 30 }),
    ).rejects.toThrow(NotFoundException);
    expect(getStoryReaderStatsForStory).not.toHaveBeenCalled();
  });

  it('throws NotFoundException from getStoryDetail when the story is soft-deleted', async () => {
    findStoryBasicById.mockResolvedValue({
      id: 's1',
      title: 'Deleted Story',
      isDeleted: true,
    });

    await expect(service.getStoryDetail('s1', { range: 30 })).rejects.toThrow(
      NotFoundException,
    );
    expect(getStoryReaderStatsForStory).not.toHaveBeenCalled();
  });

  it('re-derives readersSuppressed from the readers list if it comes back smaller than the stats query implied (defense in depth against a deletion racing the two queries)', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 5, // stats query said not suppressed...
      completedCount: 2,
      avgTimeSpentSeconds: 15,
    });
    getStoryReaderTrend.mockResolvedValue([
      { date: '2026-10-01', distinctReaders: 5, completions: 2 },
    ]);
    // ...but the readers query, run moments later, only found 4 — e.g. one
    // reader was soft-deleted in between.
    getStoryReaders.mockResolvedValue([
      {
        readerId: 'k1',
        readerType: 'kid',
        displayName: 'A',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k2',
        readerType: 'kid',
        displayName: 'B',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k3',
        readerType: 'kid',
        displayName: 'C',
        lastAccessed: new Date(),
      },
      {
        readerId: 'k4',
        readerType: 'kid',
        displayName: 'D',
        lastAccessed: new Date(),
      },
    ]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail.readersSuppressed).toBe(true);
    expect(detail.readers).toEqual([]);
    expect(detail.trend).toEqual([]);
    expect(detail.readerCount).toBeNull();
    expect(detail.completionRate).toBeNull();
    expect(detail.avgTimeSpentSeconds).toBeNull();
  });

  it('returns explicit zeros (not suppressed) from getStoryDetail for a real story with zero reading activity', async () => {
    findStoryBasicById.mockResolvedValue({ id: 's1', title: 'Unread Story' });
    getStoryReaderStatsForStory.mockResolvedValue(null);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail).toEqual({
      storyId: 's1',
      title: 'Unread Story',
      readerCount: 0,
      completionRate: 0,
      avgTimeSpentSeconds: 0,
      trend: [],
      readers: [],
      readersSuppressed: false,
    });
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

  describe('custom/extended range windows', () => {
    it('passes a 365-day window through to the engagement repo for range=365', async () => {
      getStoryReaderStats.mockResolvedValue([]);
      findTitlesByIds.mockResolvedValue([]);

      await service.getTopStories({ range: 365 });

      const { start, end } = getStoryReaderStats.mock.calls[0][0];
      const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(365, 0);
    });

    it('passes a 120-day window through to the engagement repo for range=120', async () => {
      getStoryReaderStats.mockResolvedValue([]);
      findTitlesByIds.mockResolvedValue([]);

      await service.getTopStories({ range: 120 });

      const { start, end } = getStoryReaderStats.mock.calls[0][0];
      const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(120, 0);
    });

    it('uses an explicit startDate/endDate window, taking precedence over range', async () => {
      getStoryReaderStats.mockResolvedValue([]);
      findTitlesByIds.mockResolvedValue([]);

      await service.getTopStories({
        range: 30,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      });

      const { start, end } = getStoryReaderStats.mock.calls[0][0];
      expect(start).toEqual(new Date('2026-01-01'));
      expect(end).toEqual(new Date('2026-02-01T23:59:59.999Z'));
    });

    it('applies startDate/endDate (over range) together with page/limit on the paginated endpoint', async () => {
      getStoryReaderStats.mockResolvedValue([
        {
          storyId: 's0',
          distinctReaders: 8,
          completedCount: 1,
          avgTimeSpentSeconds: 0,
        },
        {
          storyId: 's1',
          distinctReaders: 2,
          completedCount: 1,
          avgTimeSpentSeconds: 0,
        },
      ]);
      findTitlesByIds.mockResolvedValue([
        { id: 's0', title: 's0' },
        { id: 's1', title: 's1' },
      ]);

      const r = await service.getTopStoriesPage({
        range: 7,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        page: 2,
        limit: 1,
      });

      const { start, end } = getStoryReaderStats.mock.calls[0][0];
      expect(start).toEqual(new Date('2026-01-01'));
      expect(end).toEqual(new Date('2026-02-01T23:59:59.999Z'));
      expect(r.meta).toEqual({ total: 2, page: 2, limit: 1, totalPages: 2 });
      expect(r.data).toHaveLength(1);
      expect(r.data[0].readerCount).toBeNull();
    });

    it('throws BadRequestException when startDate is not before endDate', async () => {
      await expect(
        service.getTopStories({
          range: 30,
          startDate: '2026-02-01',
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(getStoryReaderStats).not.toHaveBeenCalled();
    });

    it('treats a date-only startDate/endDate on the same calendar day as a valid single-day window', async () => {
      getStoryReaderStats.mockResolvedValue([]);
      findTitlesByIds.mockResolvedValue([]);

      // Both are date-only, so endDate widens to end-of-day, making this a
      // valid (if narrow) window rather than a zero-width one.
      await service.getTopStories({
        range: 30,
        startDate: '2026-01-01',
        endDate: '2026-01-01',
      });

      const { start, end } = getStoryReaderStats.mock.calls[0][0];
      expect(start).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(end).toEqual(new Date('2026-01-01T23:59:59.999Z'));
    });

    it('throws BadRequestException when startDate equals endDate as identical full timestamps', async () => {
      await expect(
        service.getTopStories({
          range: 30,
          startDate: '2026-01-01T10:00:00.000Z',
          endDate: '2026-01-01T10:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('still applies the 5-reader suppression rule within a custom/365-day window', async () => {
      getStoryReaderStats.mockResolvedValue([
        {
          storyId: 's1',
          distinctReaders: 4,
          completedCount: 1,
          avgTimeSpentSeconds: 10,
        },
      ]);
      findTitlesByIds.mockResolvedValue([{ id: 's1', title: 'Story' }]);

      const result = await service.getTopStories({ range: 365 });

      expect(result[0].readerCount).toBeNull();
      expect(result[0].completionRate).toBeNull();
    });
  });
});
