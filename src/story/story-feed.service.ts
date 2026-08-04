import {
  STORY_REPOSITORY,
  IStoryRepository,
} from './repositories/story.repository.interface';
import {
  PaginatedStoriesDto,
  CursorPaginatedStoriesDto,
} from './dto/story.dto';
import { Category, Season, Story } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  DEFAULT_CURSOR_LIMIT,
  PaginationUtil,
} from '@/shared/utils/pagination.util';
import { GuestSessionService } from '@/guest/guest-session.service';
import { deriveReadStatus } from '@/shared/utils/read-status.util';

@Injectable()
export class StoryFeedService {
  constructor(
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly guestSessionService: GuestSessionService,
  ) {}

  /** Wraps a Prisma query to handle invalid cursor IDs gracefully */
  private async withCursorErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new BadRequestException('Invalid cursor: record not found');
      }
      throw error;
    }
  }

  private async buildStoryWhereClause(filter: {
    theme?: string;
    category?: string;
    season?: string;
    recommended?: boolean;
    isMostLiked?: boolean;
    isSeasonal?: boolean;
    age?: number;
    minAge?: number;
    maxAge?: number;
    kidId?: string;
  }): Promise<{
    where: Prisma.StoryWhereInput;
    recommendedStoryIds: string[];
  }> {
    const where: Prisma.StoryWhereInput = {
      isDeleted: false,
    };

    if (filter.theme) where.themes = { some: { id: filter.theme } };
    if (filter.category) {
      where.categories = { some: { id: filter.category } };
    }
    // Seasonal Filter (Dynamic based on date)
    if (filter.isSeasonal) {
      const { activeSeasons, backfillSeasons } =
        await this.getRelevantSeasons();
      const seasonIds = [...activeSeasons.map((s) => s.id)];

      if (backfillSeasons.length > 0) {
        seasonIds.push(...backfillSeasons.map((s) => s.id));
      }

      if (seasonIds.length > 0) {
        where.seasons = {
          some: {
            id: { in: seasonIds },
          },
        };
      } else {
        where.seasons = { some: { id: 'non-existent-id' } };
      }
    }

    if (filter.recommended !== undefined && !filter.kidId) {
      where.recommended = filter.recommended;
    }

    let targetLevel: number | undefined;
    let recommendedStoryIds: string[] = [];
    let restrictedStoryIds: string[] = [];

    // Batch kid-related queries into a single call to avoid N+1
    if (filter.kidId) {
      const kid = await this.storyRepository.findUniqueKidRaw({
        where: { id: filter.kidId, isDeleted: false },
        include: {
          preferredCategories: true,
          // Fetch parent recommendations in the same query
          parentRecommendations: {
            where: { isDeleted: false },
            select: { storyId: true },
          },
          // Fetch restricted stories in the same query
          restrictedStories: {
            select: { storyId: true },
          },
        },
      });

      if (kid) {
        // Extract recommended and restricted story IDs from the batch query
        recommendedStoryIds = kid.parentRecommendations.map(
          (rec) => rec.storyId,
        );
        restrictedStoryIds = kid.restrictedStories.map((r) => r.storyId);

        if (kid.currentReadingLevel > 0) {
          targetLevel = kid.currentReadingLevel;
          where.difficultyLevel = {
            gte: Math.max(1, targetLevel - 1),
            lte: targetLevel + 1,
          };
        } else if (kid.ageRange) {
          const match = kid.ageRange.match(/(\d+)/);
          if (match) {
            const age = parseInt(match[1], 10);
            where.ageMin = { lte: age };
            where.ageMax = { gte: age };
          }
        }

        if (filter.recommended === true) {
          delete where.recommended;
          if (!filter.category && kid.preferredCategories.length > 0) {
            const categoryIds = kid.preferredCategories.map((c) => c.id);
            where.categories = {
              some: { id: { in: categoryIds } },
            };
          }
        }
      }
    }

    if (filter.age && !targetLevel && !where.ageMin) {
      where.ageMin = { lte: filter.age };
      where.ageMax = { gte: filter.age };
    }

    // Add minAge and maxAge filter logic
    if (
      (filter.minAge !== undefined || filter.maxAge !== undefined) &&
      !targetLevel
    ) {
      // Overlap logic: story.ageMin <= filter.maxAge AND story.ageMax >= filter.minAge
      if (filter.minAge !== undefined) {
        where.ageMax = {
          ...((where.ageMax as object) || {}),
          gte: filter.minAge,
        };
      }
      if (filter.maxAge !== undefined) {
        where.ageMin = {
          ...((where.ageMin as object) || {}),
          lte: filter.maxAge,
        };
      }
    }

    if (recommendedStoryIds.length > 0 && filter.recommended === undefined) {
      const recommendedClause: Prisma.StoryWhereInput = {
        id: { in: recommendedStoryIds },
      };

      // If seasonal filter is active, enforce it on recommended stories too
      if (filter.isSeasonal && where.seasons) {
        recommendedClause.seasons = where.seasons;
      }

      where.OR = [{ ...(where as object) }, recommendedClause];
    }

    // Exclude restricted stories (already fetched in batch query above)
    if (restrictedStoryIds.length > 0) {
      where.id = { notIn: restrictedStoryIds, ...((where.id as object) || {}) };
    }

    if (filter.recommended === true && filter.kidId) {
      where.id = { in: recommendedStoryIds };
    }

    return { where, recommendedStoryIds };
  }

  async getStories(filter: {
    userId?: string;
    guestSessionId?: string;
    theme?: string;
    category?: string;
    season?: string;
    recommended?: boolean;
    isMostLiked?: boolean;
    isSeasonal?: boolean;
    topPicksFromUs?: boolean;
    age?: number;
    minAge?: number;
    maxAge?: number;
    kidId?: string;
    page?: number;
    limit?: number;
    shuffle?: boolean;
  }): Promise<PaginatedStoriesDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 12;
    const skip = (page - 1) * limit;

    const { where } = await this.buildStoryWhereClause(filter);

    // Seasonal requests are ordered by season recency (active seasons first,
    // then most recently ended). The Holiday/Seasonal category behaves like
    // isSeasonal for ordering purposes.
    let shouldSortBySeason = !!filter.isSeasonal;
    if (filter.category && !shouldSortBySeason) {
      const [category] = await this.storyRepository.findCategoriesByIds([
        filter.category,
      ]);
      if (category?.name === this.CATEGORY_HOLIDAY_SEASONAL) {
        shouldSortBySeason = true;
      }
    }

    // Shuffle only applies on page 1 (home screen carousels).
    // Beyond page 1 (paginated "See All"), disable shuffle to avoid overlapping pages.
    const shouldShuffle = filter.shuffle === true && page === 1;

    // Handle topPicksFromUs filter - get random stories using shared helper
    if (filter.topPicksFromUs) {
      const overFetchLimit = shouldShuffle ? Math.min(limit * 3, 150) : limit;
      const randomStoryIds = shouldShuffle
        ? await this.getRandomStoryIds(overFetchLimit)
        : await this.getDeterministicStoryIds(limit, skip);

      if (randomStoryIds.length === 0) {
        return {
          data: [],
          pagination: {
            currentPage: page,
            totalPages: 0,
            pageSize: limit,
            totalCount: 0,
          },
        };
      }

      // Apply random IDs to where clause
      where.id = { in: randomStoryIds, ...((where.id as object) || {}) };
    }

    const orderBy = filter.isMostLiked
      ? [
          { parentFavorites: { _count: 'desc' as const } },
          { createdAt: 'desc' as const },
          { id: 'asc' as const },
        ]
      : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    // Run count and findMany in parallel to reduce latency by ~50%
    // For topPicksFromUs, pagination is handled in the raw SQL query
    const [totalCount, queriedStories] = await Promise.all([
      filter.topPicksFromUs
        ? this.storyRepository.countStoriesRaw({ isDeleted: false })
        : this.storyRepository.countStoriesRaw(where),
      this.storyRepository.findManyStoriesRaw({
        where,
        // Season-recency ordering must rank the full result set before
        // paginating, so skip/take are applied after the sort (as with
        // topPicksFromUs, whose pagination happens in the raw id query).
        ...(filter.topPicksFromUs || shouldSortBySeason
          ? {}
          : {
              skip,
              take:
                filter.isMostLiked && shouldShuffle
                  ? Math.min(limit * 2, 100)
                  : limit,
            }),
        orderBy,
        include: {
          images: true,
          branches: true,
          categories: true,
          themes: true,
          seasons: true,
          questions: true,
          ...(filter.isMostLiked && shouldShuffle
            ? { _count: { select: { parentFavorites: true } } }
            : {}),
        },
      }),
    ]);

    let stories = queriedStories;
    if (shouldSortBySeason) {
      await this.sortStoriesBySeasonRecency(stories);
      stories = stories.slice(skip, skip + limit);
    }

    const totalPages = Math.ceil(totalCount / limit);

    // Enrich with read status based on user or guest session
    let enrichedStories;
    if (filter.userId) {
      enrichedStories = await this.enrichWithReadStatus(filter.userId, stories);
    } else if (filter.guestSessionId) {
      enrichedStories = await this.enrichWithGuestReadStatus(
        filter.guestSessionId,
        stories,
      );
    } else {
      enrichedStories = stories.map((s) => ({
        ...s,
        readStatus: null as 'done' | 'reading' | null,
      }));
    }

    let sortedStories = this.sortByReadStatus(enrichedStories, {
      shuffleUnseen: shouldShuffle,
    });

    // For mostLiked with shuffle, randomize tiebreakers within same like count
    // and readStatus so that unread-first ordering from sortByReadStatus is preserved.
    if (filter.isMostLiked && shouldShuffle) {
      sortedStories = this.shuffleTiedStories(sortedStories, (s) => {
        const favCount =
          (s as unknown as { _count?: { parentFavorites?: number } })._count
            ?.parentFavorites ?? 0;
        const readStatus =
          (s as unknown as { readStatus?: string }).readStatus ?? 'unseen';
        return `${readStatus}:${favCount}`;
      });
    }

    // Slice over-fetched results back to requested limit
    if (filter.topPicksFromUs || (filter.isMostLiked && shouldShuffle)) {
      sortedStories = sortedStories.slice(0, limit);
    }

    // Strip _count from response to avoid leaking internal fields
    const cleanedStories =
      shouldShuffle && filter.isMostLiked
        ? (sortedStories.map((s) => {
            const { _count, ...rest } = s as Record<string, unknown>;
            void _count;
            return rest;
          }) as typeof sortedStories)
        : sortedStories;

    return {
      data: cleanedStories,
      pagination: {
        currentPage: page,
        totalPages,
        pageSize: limit,
        totalCount,
      },
    };
  }

  async getStoriesCursor(filter: {
    userId?: string;
    guestSessionId?: string;
    theme?: string;
    category?: string;
    season?: string;
    isSeasonal?: boolean;
    age?: number;
    minAge?: number;
    maxAge?: number;
    kidId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPaginatedStoriesDto> {
    const limit = filter.limit ?? DEFAULT_CURSOR_LIMIT;
    const { where } = await this.buildStoryWhereClause(filter);

    const orderBy = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    const stories = await this.withCursorErrorHandling(() =>
      this.storyRepository.findManyStoriesRaw({
        where,
        take: limit + 1,
        ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
        orderBy,
        include: {
          images: true,
          branches: true,
          categories: true,
          themes: true,
          seasons: true,
          questions: true,
        },
      }),
    );

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      stories,
      limit,
    );

    // Enrich with read status based on user or guest session
    let enriched;
    if (filter.userId) {
      enriched = await this.enrichWithReadStatus(filter.userId, data);
    } else if (filter.guestSessionId) {
      enriched = await this.enrichWithGuestReadStatus(
        filter.guestSessionId,
        data,
      );
    } else {
      enriched = data.map((s) => ({
        ...s,
        readStatus: null as 'done' | 'reading' | null,
      }));
    }

    return {
      data: this.sortByReadStatus(enriched),
      pagination: {
        ...pagination,
        previousCursor: null,
        hasPreviousPage: !!filter.cursor,
        limit,
      },
    };
  }

  // Sort stories so unread appear first, then reading, then done.
  // Preserves original order within each group (stable sort).
  // When shuffleUnseen is true, Fisher-Yates shuffle the unseen bucket
  // so home screen sections show varied stories on each request.
  private sortByReadStatus<T extends { readStatus: 'done' | 'reading' | null }>(
    stories: T[],
    options?: { shuffleUnseen?: boolean },
  ): T[] {
    const unseen = stories.filter((s) => s.readStatus === null);
    const reading = stories.filter((s) => s.readStatus === 'reading');
    const done = stories.filter((s) => s.readStatus === 'done');

    if (options?.shuffleUnseen) {
      this.fisherYatesShuffle(unseen);
    }

    return [...unseen, ...reading, ...done];
  }

  /** In-place Fisher-Yates shuffle. */
  private fisherYatesShuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * Shuffle stories that share the same grouping key (e.g. equal like counts
   * and readStatus) while preserving the relative order between different groups.
   * The key function should return a string that encodes all ordering-relevant
   * dimensions so that, e.g., unseen and done stories with the same favourite
   * count are never mixed.
   */
  private shuffleTiedStories<T>(stories: T[], getKey: (s: T) => string): T[] {
    const groups = new Map<string, T[]>();
    for (const s of stories) {
      const key = getKey(s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    for (const group of groups.values()) {
      this.fisherYatesShuffle(group);
    }
    // Preserve insertion order — callers feed already-sorted input so the
    // first occurrence of each key reflects the correct group ordering.
    return [...groups.values()].flatMap((g) => g);
  }

  private async enrichWithReadStatus<T extends { id: string }>(
    userId: string,
    stories: T[],
  ): Promise<(T & { readStatus: 'done' | 'reading' | null })[]> {
    const storyIds = [...new Set(stories.map((s) => s.id))];
    if (storyIds.length === 0)
      return stories.map((s) => ({
        ...s,
        readStatus: null as 'done' | 'reading' | null,
      }));

    const readProgress =
      await this.storyRepository.findManyUserStoryProgressRaw({
        where: { userId, storyId: { in: storyIds }, isDeleted: false },
        select: { storyId: true, completed: true },
      });
    const progressMap = new Map(
      readProgress.map((p) => [p.storyId, p.completed]),
    );

    return stories.map((story) => {
      const progress = progressMap.get(story.id);
      return {
        ...story,
        readStatus:
          progress === undefined ? null : progress ? 'done' : 'reading',
      };
    });
  }

  /**
   * Enrich stories with readStatus from guest session
   */
  private async enrichWithGuestReadStatus<T extends { id: string }>(
    guestSessionId: string,
    stories: T[],
  ): Promise<(T & { readStatus: 'done' | 'reading' | null })[]> {
    const storyIds = [...new Set(stories.map((s) => s.id))];
    if (storyIds.length === 0)
      return stories.map((s) => ({
        ...s,
        readStatus: null as 'done' | 'reading' | null,
      }));

    const session =
      await this.guestSessionService.getGuestSession(guestSessionId);
    if (!session) {
      return stories.map((s) => ({
        ...s,
        readStatus: null as 'done' | 'reading' | null,
      }));
    }

    const readingHistory = session.readingHistory;
    return stories.map((story) => {
      const progress = readingHistory[story.id];
      return {
        ...story,
        readStatus: deriveReadStatus(progress?.progress, progress?.completed),
      };
    });
  }

  private readonly CATEGORY_HOLIDAY_SEASONAL = 'Holiday/Seasonal';

  /**
   * Order stories in place by season recency: stories in currently-active
   * seasons first, then by how recently their season ended (most recent
   * first). Stories with no season rank last.
   */
  private async sortStoriesBySeasonRecency(
    stories: Array<{ seasons?: Array<{ id: string }>; [key: string]: unknown }>,
  ) {
    const allSeasons = await this.storyRepository.findManySeasonsRaw({
      where: { isDeleted: false },
    });

    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate(); // 1-31
    const currentDateStr = `${currentMonth
      .toString()
      .padStart(2, '0')}-${currentDay.toString().padStart(2, '0')}`;

    const getScore = (s: Season) => {
      if (!s.startDate || !s.endDate) return Infinity;
      let isActive = false;
      if (s.startDate > s.endDate) {
        isActive = currentDateStr >= s.startDate || currentDateStr <= s.endDate;
      } else {
        isActive = currentDateStr >= s.startDate && currentDateStr <= s.endDate;
      }
      if (isActive) return -1;

      const [endMonth, endDay] = s.endDate.split('-').map(Number);
      const thisYearEnd = new Date(today.getFullYear(), endMonth - 1, endDay);
      const diffTime = today.getTime() - thisYearEnd.getTime();
      let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        const lastYearEnd = new Date(
          today.getFullYear() - 1,
          endMonth - 1,
          endDay,
        );
        diffDays = Math.ceil(
          (today.getTime() - lastYearEnd.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
      return diffDays;
    };

    allSeasons.sort((a, b) => getScore(a) - getScore(b));
    const rankMap = new Map(allSeasons.map((s, idx) => [s.id, idx]));

    stories.sort((a, b) => {
      const rankA = a.seasons?.length
        ? Math.min(...a.seasons.map((s) => rankMap.get(s.id) ?? Infinity))
        : Infinity;
      const rankB = b.seasons?.length
        ? Math.min(...b.seasons.map((s) => rankMap.get(s.id) ?? Infinity))
        : Infinity;
      return rankA - rankB;
    });
  }

  // Threshold in days to consider a past season as "recent" for backfill
  private readonly RECENT_SEASON_THRESHOLD_DAYS = 45;

  private async getRelevantSeasons() {
    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate(); // 1-31
    const currentDateStr = `${currentMonth
      .toString()
      .padStart(2, '0')}-${currentDay.toString().padStart(2, '0')}`;

    const allSeasons = await this.storyRepository.findManySeasonsRaw({
      where: { isDeleted: false },
    });

    const activeSeasons = allSeasons.filter((s) => {
      if (!s.isActive) return false;
      if (!s.startDate || !s.endDate) return false;

      if (s.startDate > s.endDate) {
        return currentDateStr >= s.startDate || currentDateStr <= s.endDate;
      }
      return currentDateStr >= s.startDate && currentDateStr <= s.endDate;
    });

    const backfillSeasons = allSeasons.filter((s) => {
      if (activeSeasons.find((active) => active.id === s.id)) return false;
      if (!s.startDate || !s.endDate) return false;

      const [endMonth, endDay] = s.endDate.split('-').map(Number);

      const seasonEndDate = new Date(today.getFullYear(), endMonth - 1, endDay);

      const diffTime = today.getTime() - seasonEndDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= this.RECENT_SEASON_THRESHOLD_DAYS) {
        return true;
      }

      if (diffDays < 0) {
        const lastYearEnd = new Date(
          today.getFullYear() - 1,
          endMonth - 1,
          endDay,
        );
        const diffLastYear = Math.ceil(
          (today.getTime() - lastYearEnd.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (
          diffLastYear >= 0 &&
          diffLastYear <= this.RECENT_SEASON_THRESHOLD_DAYS
        ) {
          return true;
        }
      }

      return false;
    });

    return { activeSeasons, backfillSeasons };
  }

  async getHomePageStories(
    userId: string | undefined,
    limitRecommended: number = 5,
    limitSeasonal: number = 5,
    limitTopLiked: number = 5,
  ) {
    const user = userId
      ? await this.storyRepository.findUniqueUserRaw({
          where: { id: userId, isDeleted: false },
          include: { preferredCategories: true },
        })
      : null;

    if (userId && !user) {
      throw new NotFoundException('User not found');
    }

    // 1. Recommended Stories (based on preferred categories)
    let recommended: Story[] = [];
    const preferredCategories = user?.preferredCategories ?? [];
    if (preferredCategories.length > 0) {
      recommended = await this.storyRepository.findManyStoriesRaw({
        where: {
          isDeleted: false,
          categories: {
            some: {
              id: { in: preferredCategories.map((c: Category) => c.id) },
            },
          },
        },
        take: limitRecommended,
        include: { images: true, categories: true },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
      });
    } else {
      // Fallback if no preferences: just fresh stories
      recommended = await this.storyRepository.findManyStoriesRaw({
        where: { isDeleted: false },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        take: limitRecommended,
        include: { images: true, categories: true },
      });
    }

    // 2. Seasonal Stories (Logic: find active season based on today's date)
    const { activeSeasons, backfillSeasons } = await this.getRelevantSeasons();

    let seasonal: Story[] = [];
    let seasonalCount = 0;

    if (activeSeasons.length > 0) {
      seasonal = await this.storyRepository.findManyStoriesRaw({
        where: {
          isDeleted: false,
          seasons: {
            some: {
              id: { in: activeSeasons.map((s) => s.id) },
            },
          },
        },
        take: limitSeasonal,
        include: { images: true, themes: true, seasons: true },
      });
      seasonalCount = seasonal.length;
    }

    // Backfill if needed
    if (seasonalCount < limitSeasonal && backfillSeasons.length > 0) {
      const needed = limitSeasonal - seasonalCount;
      const existingIds = new Set(seasonal.map((s) => s.id));

      const backfillStories = await this.storyRepository.findManyStoriesRaw({
        where: {
          isDeleted: false,
          seasons: {
            some: {
              id: { in: backfillSeasons.map((s) => s.id) },
            },
          },
          id: { notIn: Array.from(existingIds) },
        },
        take: needed,
        include: { images: true, themes: true, seasons: true },
        orderBy: { createdAt: 'desc' },
      });

      seasonal = [...seasonal, ...backfillStories];
    }

    // 3. Top Liked by Parents
    const topLiked = await this.storyRepository.findManyStoriesRaw({
      where: { isDeleted: false },
      orderBy: {
        parentFavorites: {
          _count: 'desc',
        },
      },
      take: limitTopLiked,
      include: { images: true },
    });

    // Enrich all stories with readStatus in a single DB query
    const allStories = [...recommended, ...seasonal, ...topLiked];
    const enriched = userId
      ? await this.enrichWithReadStatus(userId, allStories)
      : allStories.map((s) => ({
          ...s,
          readStatus: null as 'done' | 'reading' | null,
        }));

    const recLen = recommended.length;
    const seaLen = seasonal.length;

    return {
      recommended: this.sortByReadStatus(enriched.slice(0, recLen)),
      seasonal: this.sortByReadStatus(enriched.slice(recLen, recLen + seaLen)),
      topLiked: this.sortByReadStatus(enriched.slice(recLen + seaLen)),
    };
  }

  /**
   * Get random story IDs using raw SQL for efficiency.
   * Only suitable for single-page results (page 1) because ORDER BY RANDOM()
   * produces a different ordering on each call, causing overlapping pages.
   * @param limit - Maximum number of IDs to return
   * @returns Array of random story IDs
   */
  private async getRandomStoryIds(limit: number): Promise<string[]> {
    return this.storyRepository.getRandomStoryIdsFromStories(limit);
  }

  /**
   * Get story IDs using a deterministic (createdAt DESC) ordering.
   * Safe for paginated requests beyond page 1 where stable ordering is required.
   * @param limit - Maximum number of IDs to return
   * @param offset - Number of results to skip (for pagination)
   * @returns Array of story IDs in stable order
   */
  private async getDeterministicStoryIds(
    limit: number,
    offset: number = 0,
  ): Promise<string[]> {
    return this.storyRepository.getDeterministicStoryIdsFromStories(
      limit,
      offset,
    );
  }
}
