import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  ADMIN_ENGAGEMENT_REPOSITORY,
  IAdminEngagementRepository,
  ADMIN_STORY_REPOSITORY,
  IAdminStoryRepository,
} from './repositories';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import {
  ReadingAnalyticsRangeDto,
  TopStoriesQueryDto,
  TopStoryDto,
  StoryDetailDto,
  TrendPointDto,
  resolveReadingAnalyticsWindow,
} from './dto/reading-analytics.dto';

// Stories with fewer than this many distinct readers must never have their
// real reader count or reader identities exposed in the API response.
const READER_SUPPRESSION_THRESHOLD = 5;

// Cache key segment for a range: the day-count when it's a plain range, or
// the explicit window when a custom startDate/endDate was given (distinct
// custom windows must not collide on the same cache entry).
function rangeCacheKey(range: ReadingAnalyticsRangeDto): string {
  if (range.startDate && range.endDate) {
    return `custom:${range.startDate}:${range.endDate}`;
  }
  return String(range.range ?? 30);
}

@Injectable()
export class AdminReadingAnalyticsService {
  constructor(
    @Inject(ADMIN_ENGAGEMENT_REPOSITORY)
    private readonly engagementRepo: IAdminEngagementRepository,
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly storyRepo: IAdminStoryRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // Pagination happens after suppression and sorting, on the cached full
  // list, so page boundaries never depend on (or leak) real reader counts.
  async getTopStoriesPage(query: TopStoriesQueryDto): Promise<{
    data: TopStoryDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const all = await this.getTopStories({
      range: query.range,
      startDate: query.startDate,
      endDate: query.endDate,
    });
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      data: all.slice((page - 1) * limit, page * limit),
      meta: {
        total: all.length,
        page,
        limit,
        totalPages: Math.ceil(all.length / limit),
      },
    };
  }

  async getTopStories(range: ReadingAnalyticsRangeDto): Promise<TopStoryDto[]> {
    const cacheKey = CACHE_KEYS.READING_ANALYTICS_TOP_STORIES(
      rangeCacheKey(range),
    );
    const cached = await this.cacheManager.get<TopStoryDto[]>(cacheKey);
    if (cached) return cached;

    const stats = await this.engagementRepo.getStoryReaderStats(
      resolveReadingAnalyticsWindow(range),
    );
    const titles = await this.storyRepo.findTitlesByIds(
      stats.map((s) => s.storyId),
    );
    const titleById = new Map(titles.map((t) => [t.id, t.title]));

    const result: TopStoryDto[] = stats
      .map((s) => {
        const suppressed = s.distinctReaders < READER_SUPPRESSION_THRESHOLD;
        return {
          storyId: s.storyId,
          title: titleById.get(s.storyId) ?? 'Unknown story',
          readerCount: suppressed ? null : s.distinctReaders,
          // Suppressed alongside readerCount: with the denominator being the
          // suppressed count itself, the fraction would narrow the real
          // reader count down to a small set of candidates.
          completionRate: suppressed
            ? null
            : s.distinctReaders > 0
              ? s.completedCount / s.distinctReaders
              : 0,
        };
      })
      .sort((a, b) => (b.readerCount ?? 0) - (a.readerCount ?? 0));

    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  async getStoryDetail(
    storyId: string,
    range: ReadingAnalyticsRangeDto,
  ): Promise<StoryDetailDto> {
    const story = await this.storyRepo.findStoryBasicById(storyId);
    // findStoryBasicById is shared with delete/recommendation flows that
    // deliberately look up already-soft-deleted stories, so it does not
    // filter isDeleted itself — check it here instead of narrowing the
    // shared method for every other caller.
    if (!story || story.isDeleted) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }

    const stats =
      await this.engagementRepo.getStoryReaderStatsForStory(storyId);

    // A real story with zero reading activity is distinct from a suppressed
    // one: there is no one to protect, so it gets explicit zeros rather than
    // the privacy-suppression treatment.
    if (!stats) {
      return {
        storyId,
        title: story.title,
        readerCount: 0,
        completionRate: 0,
        avgTimeSpentSeconds: 0,
        trend: [],
        readers: [],
        readersSuppressed: false,
      };
    }

    const statsSuppressed =
      stats.distinctReaders < READER_SUPPRESSION_THRESHOLD;
    // Per-day trend counts and reader identities are both per-story reader
    // data covered by the suppression rule, so neither is fetched for a
    // suppressed story.
    const [trend, readers] = statsSuppressed
      ? [[], []]
      : await Promise.all([
          this.engagementRepo.getStoryReaderTrend(
            storyId,
            resolveReadingAnalyticsWindow(range),
          ),
          this.engagementRepo.getStoryReaders(storyId),
        ]);

    // Defense in depth: the readers query runs after the stats query, so a
    // deletion in between could drop the real reader count below the
    // threshold even though `statsSuppressed` was false. Re-derive the final
    // flag from whichever source is more conservative and use IT — not the
    // earlier `statsSuppressed` — for every field below.
    const suppressed =
      statsSuppressed || readers.length < READER_SUPPRESSION_THRESHOLD;

    return {
      storyId,
      title: story.title,
      readerCount: suppressed ? null : stats.distinctReaders,
      // Suppressed alongside readerCount/readers: with the denominator being
      // the suppressed count itself, the fraction would narrow the real
      // reader count down to a small set of candidates.
      completionRate: suppressed
        ? null
        : stats.distinctReaders > 0
          ? stats.completedCount / stats.distinctReaders
          : 0,
      avgTimeSpentSeconds: suppressed ? null : stats.avgTimeSpentSeconds,
      trend: suppressed ? [] : trend,
      readers: suppressed ? [] : readers,
      readersSuppressed: suppressed,
    };
  }

  async getStoryTrend(
    storyId: string,
    range: ReadingAnalyticsRangeDto,
  ): Promise<TrendPointDto[]> {
    const stats =
      await this.engagementRepo.getStoryReaderStatsForStory(storyId);
    if (!stats || stats.distinctReaders < READER_SUPPRESSION_THRESHOLD) {
      return [];
    }

    return this.engagementRepo.getStoryReaderTrend(
      storyId,
      resolveReadingAnalyticsWindow(range),
    );
  }
}
