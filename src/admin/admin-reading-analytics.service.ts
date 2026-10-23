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
  TopStoryDto,
  StoryDetailDto,
  TrendPointDto,
} from './dto/reading-analytics.dto';

// Stories with fewer than this many distinct readers must never have their
// real reader count or reader identities exposed in the API response.
const READER_SUPPRESSION_THRESHOLD = 5;

function rangeToDates(range: ReadingAnalyticsRangeDto): {
  start: Date;
  end: Date;
} {
  const end = new Date();
  const start = new Date(
    end.getTime() - (range.range ?? 30) * 24 * 60 * 60 * 1000,
  );
  return { start, end };
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

  async getTopStories(range: ReadingAnalyticsRangeDto): Promise<TopStoryDto[]> {
    const cacheKey = CACHE_KEYS.READING_ANALYTICS_TOP_STORIES(
      range.range ?? 30,
    );
    const cached = await this.cacheManager.get<TopStoryDto[]>(cacheKey);
    if (cached) return cached;

    const stats = await this.engagementRepo.getStoryReaderStats(
      rangeToDates(range),
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
    if (!story) {
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

    const suppressed = stats.distinctReaders < READER_SUPPRESSION_THRESHOLD;
    // Per-day trend counts and reader identities are both per-story reader
    // data covered by the suppression rule, so neither is fetched for a
    // suppressed story.
    const [trend, readers] = suppressed
      ? [[], []]
      : await Promise.all([
          this.engagementRepo.getStoryReaderTrend(storyId, rangeToDates(range)),
          this.engagementRepo.getStoryReaders(storyId),
        ]);

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
      trend,
      readers,
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
      rangeToDates(range),
    );
  }
}
