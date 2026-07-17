import { PrismaService } from '../prisma/prisma.service';
import { GuestSessionService } from '../guest/guest-session.service';
import { NotificationService } from '../notification/notification.service';

/** Max session time in seconds (24 h), matching the DTO contract. */
const MAX_SESSION_TIME = 86_400;

/** Parse, clamp and floor a raw sessionTime value to a safe integer in [0, MAX_SESSION_TIME]. */
function normalizeSessionTime(value: unknown): number {
  const raw = Number(value ?? 0);
  return Number.isFinite(raw)
    ? Math.min(Math.max(0, Math.floor(raw)), MAX_SESSION_TIME)
    : 0;
}
import {
  CreateStoryDto,
  UpdateStoryDto,
  StoryImageDto,
  StoryBranchDto,
  FavoriteDto,
  StoryProgressDto,
  DailyChallengeDto,
  AssignDailyChallengeDto,
  CompleteDailyChallengeDto,
  DailyChallengeAssignmentDto,
  StartStoryPathDto,
  UpdateStoryPathDto,
  StoryPathDto,
  CategoryDto,
  ThemeDto,
  PaginatedStoriesDto,
  CursorPaginatedStoriesDto,
  ParentRecommendationDto,
  RecommendationResponseDto,
  RecommendationsStatsDto,
  RestrictStoryDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';

import { UploadService } from '../upload/upload.service';
import {
  StoryPath,
  DailyChallengeAssignment,
  Category,
  Theme,
  DailyChallenge,
  ParentRecommendation,
} from '@prisma/client';
import { Prisma, Season } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TextToSpeechService } from './text-to-speech.service';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  GeminiService,
  GenerateStoryOptions,
  GeneratedStory,
} from './gemini.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../voice/dto/voice.dto';
import { DEFAULT_VOICE } from '../voice/voice.constants';
import { STORY_INVALIDATION_KEYS } from '@/shared/constants/cache-keys.constants';
import { deriveReadStatus } from '@/shared/utils/read-status.util';
import {
  DEFAULT_CURSOR_LIMIT,
  PaginationUtil,
} from '@/shared/utils/pagination.util';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);
  // Average reading speed for children: ~150 words per minute
  private readonly WORDS_PER_MINUTE = 150;
  private readonly CATEGORY_HOLIDAY_SEASONAL = 'Holiday/Seasonal';
  /** Standard relations returned by story list endpoints (used for fresh-first read backfill). */
  private readonly storyListInclude: Prisma.StoryInclude = {
    images: true,
    branches: true,
    categories: true,
    themes: true,
    seasons: true,
    questions: true,
  };

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

  /** Invalidate all story-related caches */
  private async invalidateStoryCaches(): Promise<void> {
    try {
      await Promise.all(
        STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to invalidate story caches: ${msg}`);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly geminiService: GeminiService,
    private readonly guestSessionService: GuestSessionService,
    // NotificationModule is @Global, so no module import change is needed.
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Calculate estimated reading duration in seconds based on text content or word count
   */
  calculateDurationSeconds(textOrWordCount: string | number): number {
    const wordCount =
      typeof textOrWordCount === 'string'
        ? textOrWordCount.split(/\s+/).filter((word) => word.length > 0).length
        : textOrWordCount;

    if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;

    // Convert words per minute to seconds: (wordCount / wordsPerMinute) * 60
    return Math.ceil((wordCount / this.WORDS_PER_MINUTE) * 60);
  }

  private async buildStoryWhereClause(filter: {
    userId?: string;
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
    if (filter.season) {
      where.seasons = { some: { id: filter.season } };
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
      const kid = await this.prisma.kid.findUnique({
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

    let shouldSortBySeason = !!filter.isSeasonal;
    if (filter.category && !shouldSortBySeason) {
      const category = await this.prisma.category.findUnique({
        where: { id: filter.category },
        select: { name: true },
      });
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

    // Fresh-first: authenticated users fetch FRESH stories only here (no
    // non-deleted progress row). Read stories are added afterwards as backfill.
    // Guests get `where` unchanged (byte-for-byte identical responses).
    // totalCount is still counted on the unfiltered `where` so it reflects the
    // full result set (fresh + read) and pagination metadata stays correct.
    const freshWhere = this.withUserReadFilter(where, filter.userId, 'fresh');

    // Run count and findMany in parallel to reduce latency by ~50%
    // For topPicksFromUs, pagination is handled in the raw SQL query
    const [totalCount, queriedStories] = await Promise.all([
      filter.topPicksFromUs
        ? this.prisma.story.count({ where: { isDeleted: false } })
        : this.prisma.story.count({ where }),
      this.prisma.story.findMany({
        where: freshWhere,
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
      enrichedStories = stories.map((s) => ({ ...s, readStatus: null }));
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

    // Fresh-first backfill (authenticated users only): the page above is drawn
    // from FRESH stories only. If the fresh pool cannot fill the requested
    // limit, top up with already-read stories ranked last (most recently
    // accessed first). For page 1 (and the page-1 carousels) readSkip is 0; for
    // deeper offset pages we compute how many read rows earlier pages already
    // consumed via `skip - freshCount` so there is no overlap or gap.
    let pageData = cleanedStories as unknown as Record<string, unknown>[];
    if (filter.userId) {
      const deficit = limit - pageData.length;
      if (deficit > 0) {
        // For topPicksFromUs the page is already scoped by a per-page id window
        // (where.id in randomStoryIds), so applying the global read offset would
        // skip inside that small window and leave the page short — backfill from
        // the start of the window instead.
        const freshCount =
          !filter.topPicksFromUs && skip > 0
            ? await this.prisma.story.count({ where: freshWhere })
            : 0;
        const readSkip = filter.topPicksFromUs
          ? 0
          : Math.max(0, skip - freshCount);
        const backfill = await this.fetchReadBackfill(
          where,
          filter.userId,
          readSkip,
          deficit,
          this.storyListInclude,
        );
        if (backfill.length > 0) {
          const enrichedBackfill = await this.enrichWithReadStatus(
            filter.userId,
            backfill,
          );
          pageData = [
            ...pageData,
            ...(enrichedBackfill as unknown as Record<string, unknown>[]),
          ];
        }
      }
    }

    return {
      data: pageData,
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

    // GUEST / PUBLIC PATH — unchanged behaviour (byte-for-byte identical).
    if (!filter.userId) {
      const stories = await this.withCursorErrorHandling(() =>
        this.prisma.story.findMany({
          where,
          take: limit + 1,
          ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
          orderBy,
          include: this.storyListInclude,
        }),
      );

      const { data, pagination } = PaginationUtil.buildCursorResponse(
        stories,
        limit,
      );

      const enriched = filter.guestSessionId
        ? await this.enrichWithGuestReadStatus(filter.guestSessionId, data)
        : data.map((s) => ({ ...s, readStatus: null }));

      return { data: this.sortByReadStatus(enriched), pagination };
    }

    // AUTHENTICATED PATH — fresh-first with read backfill across a composite
    // cursor. Format: `r:<progressId>` continues the READ stream; anything else
    // (a bare story id or `f:<storyId>`, incl. legacy raw cursors) continues the
    // FRESH stream. Fresh stories are served first; once the fresh pool is
    // exhausted we backfill with read stories ordered by lastAccessed desc.
    // NOTE: the cursor stays a single opaque string for the client.
    const userId = filter.userId;
    const rawCursor = filter.cursor;

    // READ stream continuation.
    if (rawCursor?.startsWith('r:')) {
      const progressCursor = rawCursor.slice(2) || undefined;
      return this.fetchReadStreamPage(userId, where, progressCursor, limit);
    }

    // FRESH stream (default / start). Tolerate legacy bare story-id cursors.
    const freshCursor = rawCursor?.startsWith('f:')
      ? rawCursor.slice(2) || undefined
      : rawCursor;
    const freshWhere = this.withUserReadFilter(where, userId, 'fresh');

    const freshRows = await this.withCursorErrorHandling(() =>
      this.prisma.story.findMany({
        where: freshWhere,
        take: limit + 1,
        ...(freshCursor ? { cursor: { id: freshCursor }, skip: 1 } : {}),
        orderBy,
        include: this.storyListInclude,
      }),
    );

    const freshHasNext = freshRows.length > limit;
    const freshPage = freshHasNext ? freshRows.slice(0, limit) : freshRows;
    const freshEnriched = freshPage.map((s) => ({
      ...s,
      readStatus: null as 'done' | 'reading' | null,
    }));

    // Fresh stories still remain — keep serving fresh first.
    if (freshHasNext) {
      return {
        data: freshEnriched,
        pagination: {
          nextCursor: `f:${freshPage[freshPage.length - 1].id}`,
          hasNextPage: true,
        },
      };
    }

    // Fresh pool exhausted on this page. Backfill the remainder of the page from
    // the start of the READ stream; if the page is already full, signal that the
    // read stream begins on the next request via the `r:` sentinel cursor.
    const deficit = limit - freshPage.length;
    if (deficit <= 0) {
      const readProbe = await this.prisma.userStoryProgress.findFirst({
        where: { userId, isDeleted: false, story: { ...where } },
        orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
        select: { id: true },
      });
      return {
        data: freshEnriched,
        pagination: {
          nextCursor: readProbe ? 'r:' : null,
          hasNextPage: !!readProbe,
        },
      };
    }

    const readRows = await this.prisma.userStoryProgress.findMany({
      where: { userId, isDeleted: false, story: { ...where } },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      take: deficit + 1,
      include: { story: { include: this.storyListInclude } },
    });
    const readHasNext = readRows.length > deficit;
    const readPage = readHasNext ? readRows.slice(0, deficit) : readRows;
    const readEnriched = await this.enrichWithReadStatus(
      userId,
      readPage.map((r) => r.story as unknown as { id: string }),
    );

    return {
      data: [
        ...(freshEnriched as unknown as Record<string, unknown>[]),
        ...(readEnriched as unknown as Record<string, unknown>[]),
      ],
      pagination: {
        nextCursor: readHasNext
          ? `r:${readPage[readPage.length - 1].id}`
          : null,
        hasNextPage: readHasNext,
      },
    };
  }

  /**
   * Serves a page of the READ stream for the fresh-first cursor pagination.
   * Records come from the progress join table ordered by lastAccessed desc, so
   * the cursor is the UserStoryProgress id (prefixed `r:` by the caller).
   */
  private async fetchReadStreamPage(
    userId: string,
    baseWhere: Prisma.StoryWhereInput,
    progressCursor: string | undefined,
    limit: number,
  ): Promise<CursorPaginatedStoriesDto> {
    const rows = await this.withCursorErrorHandling(() =>
      this.prisma.userStoryProgress.findMany({
        where: { userId, isDeleted: false, story: { ...baseWhere } },
        orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        ...(progressCursor ? { cursor: { id: progressCursor }, skip: 1 } : {}),
        include: { story: { include: this.storyListInclude } },
      }),
    );

    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    const enriched = await this.enrichWithReadStatus(
      userId,
      page.map((r) => r.story as unknown as { id: string }),
    );

    return {
      data: enriched as unknown as Record<string, unknown>[],
      pagination: {
        nextCursor: hasNextPage ? `r:${page[page.length - 1].id}` : null,
        hasNextPage,
      },
    };
  }

  private mapProgressRecord(record: {
    id: string;
    progress: number;
    totalTimeSpent: number;
    lastAccessed: Date;
    story: Record<string, unknown>;
  }) {
    return {
      ...record.story,
      progressId: record.id,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
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

    const readProgress = await this.prisma.userStoryProgress.findMany({
      where: { userId, storyId: { in: storyIds }, isDeleted: false },
      select: { storyId: true, progress: true, completed: true },
    });
    const progressMap = new Map(
      readProgress.map((p) => [
        p.storyId,
        { progress: p.progress, completed: p.completed },
      ]),
    );

    return stories.map((story) => {
      const progress = progressMap.get(story.id);
      // Align home read-status with the library's `completed` boolean: a story
      // is "done" when explicitly completed OR at 100% progress, "reading" when
      // partially read, and unseen only when there is no meaningful progress.
      return {
        ...story,
        readStatus: deriveReadStatus(progress?.progress, progress?.completed),
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

  /**
   * Wraps a story `where` clause with a user read/fresh filter at the TOP LEVEL
   * (AND), so it is never bypassed by the recommended-OR rewrite or the
   * topPicks `id.in` / restricted `id.notIn` rewrites inside
   * buildStoryWhereClause. A story counts as "read" when the user has any
   * non-deleted UserStoryProgress row for it (in-progress OR done); "fresh"
   * means no such row.
   *
   * - mode 'fresh' -> stories the user has NOT read (userProgress none)
   * - mode 'read'  -> stories the user HAS read (userProgress some)
   *
   * Guests / unauthenticated callers (no userId) get the clause back unchanged,
   * so their responses stay byte-for-byte identical.
   */
  private withUserReadFilter(
    where: Prisma.StoryWhereInput,
    userId: string | undefined,
    mode: 'fresh' | 'read',
  ): Prisma.StoryWhereInput {
    if (!userId) return where;
    const relation: Prisma.StoryWhereInput =
      mode === 'fresh'
        ? { userProgress: { none: { userId, isDeleted: false } } }
        : { userProgress: { some: { userId, isDeleted: false } } };
    return { AND: [where, relation] };
  }

  /**
   * Fetches already-read stories for the fresh-first backfill, ranked
   * most-recently-accessed first. Reads the progress join table so we can order
   * by `lastAccessed` (not orderable as a Story to-many relation) and returns
   * the underlying Story rows. `baseWhere` is the catalog filter WITHOUT any
   * user read filter applied.
   */
  private async fetchReadBackfill(
    baseWhere: Prisma.StoryWhereInput,
    userId: string,
    skip: number,
    take: number,
    include: Prisma.StoryInclude,
  ): Promise<Array<{ id: string }>> {
    if (take <= 0) return [];
    const rows = await this.prisma.userStoryProgress.findMany({
      where: { userId, isDeleted: false, story: { ...baseWhere } },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      ...(skip > 0 ? { skip } : {}),
      take,
      include: { story: { include } },
    });
    return rows.map((r) => r.story as unknown as { id: string });
  }

  /**
   * Tops a fresh section list up to `take` items with already-read stories
   * (recent first) when there aren't enough fresh ones. Used by the home-page
   * carousels. Guests (no userId) get the fresh list back unchanged.
   */
  private async topUpWithRead<T extends { id: string }>(
    fresh: T[],
    baseWhere: Prisma.StoryWhereInput,
    userId: string | undefined,
    take: number,
    include: Prisma.StoryInclude,
    storyOrderBy?:
      | Prisma.StoryOrderByWithRelationInput
      | Prisma.StoryOrderByWithRelationInput[],
  ): Promise<T[]> {
    if (!userId) return fresh;
    const deficit = take - fresh.length;
    if (deficit <= 0) return fresh;
    // When the section has a story-level ranking (e.g. most-liked), backfill by
    // querying read stories with that same ordering so the section's ranking
    // contract is preserved. Otherwise backfill most-recently-read (ordered via
    // the progress row, which is where lastAccessed lives).
    if (storyOrderBy) {
      const stories = await this.prisma.story.findMany({
        where: this.withUserReadFilter(baseWhere, userId, 'read'),
        orderBy: storyOrderBy,
        take: deficit,
        include,
      });
      return [...fresh, ...(stories as unknown as T[])];
    }
    const rows = await this.prisma.userStoryProgress.findMany({
      where: { userId, isDeleted: false, story: { ...baseWhere } },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      take: deficit,
      include: { story: { include } },
    });
    return [...fresh, ...rows.map((r) => r.story as unknown as T)];
  }

  // Threshold in days to consider a past season as "recent" for backfill
  private readonly RECENT_SEASON_THRESHOLD_DAYS = 45;

  private async sortStoriesBySeasonRecency(
    stories: Array<{ seasons?: Array<{ id: string }>; [key: string]: unknown }>,
  ) {
    const allSeasons = await this.prisma.season.findMany({
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

  private async getRelevantSeasons() {
    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate(); // 1-31
    const currentDateStr = `${currentMonth
      .toString()
      .padStart(2, '0')}-${currentDay.toString().padStart(2, '0')}`;

    const allSeasons = await this.prisma.season.findMany({
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
      ? await this.prisma.user.findUnique({
          where: { id: userId, isDeleted: false },
          include: { preferredCategories: true },
        })
      : null;

    if (userId && !user) {
      throw new NotFoundException('User not found');
    }

    // 1. Recommended Stories (based on preferred categories)
    let recommended: Awaited<ReturnType<typeof this.prisma.story.findMany>> =
      [];
    const preferredCategories = user?.preferredCategories ?? [];
    const recInclude: Prisma.StoryInclude = { images: true, categories: true };
    const recBaseWhere: Prisma.StoryWhereInput =
      preferredCategories.length > 0
        ? {
            isDeleted: false,
            categories: {
              some: {
                id: { in: preferredCategories.map((c: Category) => c.id) },
              },
            },
          }
        : { isDeleted: false };
    // Fresh-first: fetch unread recommendations, then top up with read ones.
    recommended = await this.prisma.story.findMany({
      where: this.withUserReadFilter(recBaseWhere, userId, 'fresh'),
      take: limitRecommended,
      include: recInclude,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
    });
    recommended = await this.topUpWithRead(
      recommended,
      recBaseWhere,
      userId,
      limitRecommended,
      recInclude,
    );

    // 2. Seasonal Stories (Logic: find active season based on today's date)
    const { activeSeasons, backfillSeasons } = await this.getRelevantSeasons();

    let seasonal: Awaited<ReturnType<typeof this.prisma.story.findMany>> = [];
    let seasonalCount = 0;
    const seasonalInclude: Prisma.StoryInclude = {
      images: true,
      themes: true,
      seasons: true,
    };

    if (activeSeasons.length > 0) {
      // Fresh-first: only unread seasonal stories in the primary fetch.
      seasonal = await this.prisma.story.findMany({
        where: this.withUserReadFilter(
          {
            isDeleted: false,
            seasons: {
              some: {
                id: { in: activeSeasons.map((s) => s.id) },
              },
            },
          },
          userId,
          'fresh',
        ),
        take: limitSeasonal,
        include: seasonalInclude,
      });
      seasonalCount = seasonal.length;
    }

    // Backfill with other (recent) seasons' fresh stories if needed
    if (seasonalCount < limitSeasonal && backfillSeasons.length > 0) {
      const needed = limitSeasonal - seasonalCount;
      const existingIds = new Set(seasonal.map((s) => s.id));

      const backfillStories = await this.prisma.story.findMany({
        where: this.withUserReadFilter(
          {
            isDeleted: false,
            seasons: {
              some: {
                id: { in: backfillSeasons.map((s) => s.id) },
              },
            },
            id: { notIn: Array.from(existingIds) },
          },
          userId,
          'fresh',
        ),
        take: needed,
        include: seasonalInclude,
        orderBy: { createdAt: 'desc' },
      });

      seasonal = [...seasonal, ...backfillStories];
    }

    // Final fresh-first top-up: if still short on fresh seasonal stories, fill
    // with already-read seasonal stories (active or recent seasons).
    seasonal = await this.topUpWithRead(
      seasonal,
      {
        isDeleted: false,
        seasons: {
          some: {
            id: {
              in: [
                ...activeSeasons.map((s) => s.id),
                ...backfillSeasons.map((s) => s.id),
              ],
            },
          },
        },
      },
      userId,
      limitSeasonal,
      seasonalInclude,
    );

    // 3. Top Liked by Parents (fresh-first, then top up with read)
    const topLikedInclude: Prisma.StoryInclude = { images: true };
    let topLiked = await this.prisma.story.findMany({
      where: this.withUserReadFilter({ isDeleted: false }, userId, 'fresh'),
      orderBy: {
        parentFavorites: {
          _count: 'desc',
        },
      },
      take: limitTopLiked,
      include: topLikedInclude,
    });
    topLiked = await this.topUpWithRead(
      topLiked,
      { isDeleted: false },
      userId,
      limitTopLiked,
      topLikedInclude,
      { parentFavorites: { _count: 'desc' } },
    );

    // Enrich all stories with readStatus in a single DB query
    const allStories = [...recommended, ...seasonal, ...topLiked];
    const enriched = userId
      ? await this.enrichWithReadStatus(userId, allStories)
      : allStories.map((s) => ({ ...s, readStatus: null }));

    const recLen = recommended.length;
    const seaLen = seasonal.length;

    return {
      recommended: this.sortByReadStatus(enriched.slice(0, recLen)),
      seasonal: this.sortByReadStatus(enriched.slice(recLen, recLen + seaLen)),
      topLiked: this.sortByReadStatus(enriched.slice(recLen + seaLen)),
    };
  }

  async createStory(data: CreateStoryDto) {
    if (data.categoryIds && data.categoryIds.length > 0) {
      const categories = await this.prisma.category.findMany({
        where: { id: { in: data.categoryIds } },
      });
      if (categories.length !== data.categoryIds.length) {
        throw new BadRequestException('One or more categories not found');
      }
    }

    const audioUrl = data.audioUrl;

    const story = await this.prisma.story.create({
      data: {
        title: data.title,
        description: data.description,
        language: data.language,
        coverImageUrl: data.coverImageUrl ?? '',
        audioUrl: audioUrl ?? '',
        isInteractive: data.isInteractive ?? false,
        ageMin: data.ageMin ?? 0,
        ageMax: data.ageMax ?? 9,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
        categories: data.categoryIds
          ? { connect: data.categoryIds.map((id) => ({ id })) }
          : undefined,
        themes: data.themeIds
          ? { connect: data.themeIds.map((id) => ({ id })) }
          : undefined,
        seasons: data.seasonIds
          ? { connect: data.seasonIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { images: true, branches: true },
    });

    // Announce the new catalog story to all users — batched, preference-aware,
    // and best-effort. Fire-and-forget so story creation isn't blocked.
    void this.notificationService
      .broadcastNewStoryToUsers(story.id, story.title)
      .catch((error) =>
        this.logger.warn(
          `NewStory broadcast failed for story ${story.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );

    await this.invalidateStoryCaches();
    return story;
  }

  async updateStory(id: string, data: UpdateStoryDto) {
    const story = await this.prisma.story.findUnique({
      where: { id, isDeleted: false },
    });

    if (!story) throw new NotFoundException('Story not found');

    const updatedStory = await this.prisma.story.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        language: data.language,
        coverImageUrl: data.coverImageUrl,
        isInteractive: data.isInteractive,
        ageMin: data.ageMin,
        ageMax: data.ageMax,
        audioUrl: data.audioUrl,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
        categories: data.categoryIds
          ? { set: data.categoryIds.map((id) => ({ id })) }
          : undefined,
        themes: data.themeIds
          ? { set: data.themeIds.map((id) => ({ id })) }
          : undefined,
        seasons: data.seasonIds
          ? { set: data.seasonIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { images: true, branches: true },
    });

    await this.invalidateStoryCaches();
    return updatedStory;
  }

  async deleteStory(id: string, permanent: boolean = false) {
    const story = await this.prisma.story.findUnique({
      where: { id, ...(permanent ? {} : { isDeleted: false }) },
    });
    if (!story) throw new NotFoundException('Story not found');

    let result;
    if (permanent) {
      result = await this.prisma.story.delete({ where: { id } });
    } else {
      result = await this.prisma.story.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }

    await this.invalidateStoryCaches();
    return result;
  }

  async undoDeleteStory(id: string) {
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException('Story not found');
    if (!story.isDeleted) throw new BadRequestException('Story is not deleted');

    const result = await this.prisma.story.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });

    await this.invalidateStoryCaches();
    return result;
  }

  async addImage(storyId: string, image: StoryImageDto) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyImage.create({ data: { ...image, storyId } });
  }

  async addBranch(storyId: string, branch: StoryBranchDto) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyBranch.create({
      data: { ...branch, storyId },
    });
  }

  async addFavorite(dto: FavoriteDto) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.favorite.create({
      data: { kidId: dto.kidId, storyId: dto.storyId },
    });
  }

  async removeFavorite(kidId: string, storyId: string) {
    return await this.prisma.favorite.deleteMany({ where: { kidId, storyId } });
  }

  async getFavorites(kidId: string, cursor?: string, limit?: number) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');

    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const records = await this.withCursorErrorHandling(() =>
      this.prisma.favorite.findMany({
        where: { kidId, isDeleted: false, story: { isDeleted: false } },
        include: { story: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: records,
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    return PaginationUtil.buildCursorResponse(records, take);
  }

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const sessionTime = normalizeSessionTime(dto.sessionTime);
    const clampedProgress = Math.max(0, Math.min(100, dto.progress));

    const existing = await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
    });

    // Completion is monotonic: once a story is completed it stays completed
    // until the dedicated remove/reset endpoint clears it (which hard-deletes
    // the row for kids). Completion is also auto-derived when progress reaches
    // 100, so a read-to-end finish is recorded even if the client never sends
    // an explicit `completed` flag, and a later partial-progress ping can no
    // longer silently un-complete the story.
    const shouldComplete =
      existing?.completed === true ||
      dto.completed === true ||
      clampedProgress >= 100;

    // Upsert progress/time only. Completion is applied via an atomic flip below
    // (updateMany gated on completed:false) so that two concurrent 100%
    // completions can't both observe a pre-completion state and each call
    // adjustReadingLevel — only the request that actually flips false->true
    // performs the (non-idempotent) reading-level adjustment.
    let result = await this.prisma.storyProgress.upsert({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
      update: {
        progress: clampedProgress,
        lastAccessed: new Date(),
        totalTimeSpent: { increment: sessionTime },
      },
      create: {
        kidId: dto.kidId,
        storyId: dto.storyId,
        progress: clampedProgress,
        completed: false,
        totalTimeSpent: sessionTime,
      },
    });

    let newlyCompleted = false;
    if (shouldComplete && !result.completed) {
      const flipped = await this.prisma.storyProgress.updateMany({
        where: { kidId: dto.kidId, storyId: dto.storyId, completed: false },
        data: { completed: true },
      });
      newlyCompleted = flipped.count === 1;
      if (newlyCompleted) result = { ...result, completed: true };
    }

    if (newlyCompleted) {
      this.adjustReadingLevel(
        dto.kidId,
        dto.storyId,
        result.totalTimeSpent,
      ).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Failed to adjust reading level: ${msg}`);
      });

      // Best-effort StoryFinished notification to the kid's parent. Emitted only
      // on the false->true completion transition (newlyCompleted). Must never
      // break the progress flow, so failures are logged and swallowed.
      try {
        await this.notificationService.sendNotification(
          'StoryFinished',
          { kidName: kid.name ?? 'Your child', storyTitle: story.title },
          kid.parentId,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Failed to send StoryFinished notification: ${msg}`);
      }
    }
    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  // --- USER STORY PROGRESS (Parent/User - non-kid specific) ---

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
    });

    const sessionTime = normalizeSessionTime(dto.sessionTime);
    const clampedProgress = Math.max(0, Math.min(100, dto.progress));

    // If restoring a soft-deleted record, reset totalTimeSpent instead of
    // accumulating stale time from before the removal.
    const totalTimeSpentUpdate = existing?.isDeleted
      ? sessionTime
      : { increment: sessionTime };

    const shouldComplete =
      existing?.completed === true ||
      dto.completed === true ||
      clampedProgress >= 100;

    // Completion is monotonic under concurrency: the update path never writes
    // `completed`, so a stale partial-progress request (which read the row
    // before another request completed it) can't overwrite completed:true with
    // false. Completion is only ever flipped to true via the atomic updateMany
    // below (gated on completed:false). The remove/reset endpoint remains the
    // only way to clear it.
    const result = await this.prisma.userStoryProgress.upsert({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
      update: {
        progress: clampedProgress,
        lastAccessed: new Date(),
        totalTimeSpent: totalTimeSpentUpdate,
        // Restore soft-deleted records when user re-reads a removed story
        isDeleted: false,
        deletedAt: null,
      },
      create: {
        userId,
        storyId: dto.storyId,
        progress: clampedProgress,
        completed: false,
        totalTimeSpent: sessionTime,
      },
    });

    let completed = result.completed;
    if (shouldComplete && !completed) {
      await this.prisma.userStoryProgress.updateMany({
        where: { userId, storyId: dto.storyId, completed: false },
        data: { completed: true },
      });
      completed = true;
    }

    return {
      id: result.id,
      storyId: result.storyId,
      progress: result.progress,
      completed,
      lastAccessed: result.lastAccessed,
      totalTimeSpent: result.totalTimeSpent,
    };
  }

  async getUserProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgressResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found');
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const progress = await this.prisma.userStoryProgress.findFirst({
      where: { userId, storyId, isDeleted: false },
    });

    if (!progress) return null;

    return {
      id: progress.id,
      storyId: progress.storyId,
      progress: progress.progress,
      completed: progress.completed,
      lastAccessed: progress.lastAccessed,
      totalTimeSpent: progress.totalTimeSpent,
    };
  }

  async getUserContinueReading(
    userId: string,
    cursor?: string,
    limit?: number,
  ) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const progressRecords = await this.withCursorErrorHandling(() =>
      this.prisma.userStoryProgress.findMany({
        where: {
          userId,
          progress: { gte: 0 },
          completed: false,
          isDeleted: false,
          story: { isDeleted: false },
        },
        orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
        include: {
          story: {
            include: { categories: true },
          },
        },
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: progressRecords.map((r) => this.mapProgressRecord(r)),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    // Cursor comes from progress table ID (Prisma cursor operates on this table).
    // Build response from raw records first, then map to the enriched shape.
    const { data, pagination } = PaginationUtil.buildCursorResponse(
      progressRecords,
      take,
    );
    return { data: data.map((r) => this.mapProgressRecord(r)), pagination };
  }

  async getUserCompletedStories(
    userId: string,
    cursor?: string,
    limit?: number,
  ) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const records = await this.withCursorErrorHandling(() =>
      this.prisma.userStoryProgress.findMany({
        where: {
          userId,
          completed: true,
          isDeleted: false,
          story: { isDeleted: false },
        },
        orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
        include: {
          story: {
            include: { categories: true },
          },
        },
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: records.map((r) => r.story),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      records,
      take,
    );
    return { data: data.map((r) => r.story), pagination };
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    return await this.prisma.$transaction([
      this.prisma.parentFavorite.deleteMany({ where: { userId, storyId } }),
      // Soft-delete progress so checkStoryAccess still recognises the story
      // as "already read" and free users can re-read without spending quota.
      this.prisma.userStoryProgress.updateMany({
        where: { userId, storyId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          progress: 0,
          completed: false,
        },
      }),
    ]);
  }

  async restrictStory(dto: RestrictStoryDto & { userId: string }) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');

    // Ensure parent owns the kid
    if (kid.parentId !== dto.userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    return await this.prisma.restrictedStory.upsert({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
      create: {
        kidId: dto.kidId,
        storyId: dto.storyId,
        userId: dto.userId,
        reason: dto.reason,
      },
      update: {
        reason: dto.reason,
      },
    });
  }

  async unrestrictStory(kidId: string, storyId: string, userId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');

    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const restriction = await this.prisma.restrictedStory.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });

    if (!restriction) {
      throw new NotFoundException('Story is not restricted for this kid');
    }

    return await this.prisma.restrictedStory.delete({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async getRestrictedStories(kidId: string, userId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');

    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const restricted = await this.prisma.restrictedStory.findMany({
      where: { kidId },
      include: { story: true },
    });

    return restricted.map((r) => ({
      ...r.story,
      restrictionReason: r.reason,
      restrictedAt: r.createdAt,
    }));
  }

  async setDailyChallenge(dto: DailyChallengeDto) {
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.dailyChallenge.create({ data: dto });
  }

  async getDailyChallenge(date: string) {
    return await this.prisma.dailyChallenge.findMany({
      where: { challengeDate: new Date(date), isDeleted: false },
      include: { story: true },
    });
  }

  // ... [Keep Assignment, Voice, and StoryPath methods] ...

  private toDailyChallengeAssignmentDto(
    assignment: DailyChallengeAssignment,
  ): DailyChallengeAssignmentDto {
    return {
      id: assignment.id,
      kidId: assignment.kidId,
      challengeId: assignment.challengeId,
      completed: assignment.completed,
      completedAt: assignment.completedAt ?? undefined,
      assignedAt: assignment.assignedAt,
    };
  }

  async assignDailyChallenge(
    dto: AssignDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const challenge = await this.prisma.dailyChallenge.findUnique({
      where: { id: dto.challengeId, isDeleted: false },
    });
    if (!challenge) throw new NotFoundException('Daily challenge not found');

    const assignment = await this.prisma.dailyChallengeAssignment.create({
      data: { kidId: dto.kidId, challengeId: dto.challengeId },
    });
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async completeDailyChallenge(
    dto: CompleteDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    const assignment = await this.prisma.dailyChallengeAssignment.update({
      where: { id: dto.assignmentId },
      data: { completed: true, completedAt: new Date() },
    });
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async getAssignmentsForKid(
    kidId: string,
  ): Promise<DailyChallengeAssignmentDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: { kidId },
    });
    return assignments.map((a: DailyChallengeAssignment) =>
      this.toDailyChallengeAssignmentDto(a),
    );
  }

  async getAssignmentById(
    id: string,
  ): Promise<DailyChallengeAssignmentDto | null> {
    const assignment = await this.prisma.dailyChallengeAssignment.findUnique({
      where: { id },
    });
    return assignment ? this.toDailyChallengeAssignmentDto(assignment) : null;
  }

  private toStoryPathDto(path: StoryPath): StoryPathDto {
    return {
      id: path.id,
      kidId: path.kidId,
      storyId: path.storyId,
      path: path.path,
      startedAt: path.startedAt,
      completedAt: path.completedAt ?? undefined,
    };
  }

  async startStoryPath(dto: StartStoryPathDto): Promise<StoryPathDto> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const storyPath = await this.prisma.storyPath.create({
      data: { kidId: dto.kidId, storyId: dto.storyId, path: '' },
    });
    return this.toStoryPathDto(storyPath);
  }

  async updateStoryPath(dto: UpdateStoryPathDto): Promise<StoryPathDto> {
    const storyPath = await this.prisma.storyPath.update({
      where: { id: dto.pathId },
      data: { path: dto.path, completedAt: dto.completedAt },
    });
    return this.toStoryPathDto(storyPath);
  }

  async getStoryPathsForKid(kidId: string): Promise<StoryPathDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const paths = await this.prisma.storyPath.findMany({ where: { kidId } });
    return paths.map((p: StoryPath) => this.toStoryPathDto(p));
  }

  async getStoryPathById(id: string): Promise<StoryPathDto | null> {
    const path = await this.prisma.storyPath.findUnique({ where: { id } });
    return path ? this.toStoryPathDto(path) : null;
  }

  async getCategories(): Promise<CategoryDto[]> {
    this.logger.log('Fetching categories with story counts from database');
    const categories = await this.prisma.category.findMany({
      where: { isDeleted: false },
      include: { _count: { select: { stories: true } } },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image ?? undefined,
      description: c.description ?? undefined,
      storyCount: c._count.stories,
    }));
  }

  async getThemes(): Promise<ThemeDto[]> {
    const themes = await this.prisma.theme.findMany({
      where: { isDeleted: false },
    });
    return themes.map((t: Theme) => ({
      ...t,
      image: t.image ?? undefined,
      description: t.description ?? undefined,
    }));
  }

  async getSeasons() {
    const seasons = await this.prisma.season.findMany({
      where: { isDeleted: false },
      orderBy: { startDate: 'asc' },
    });
    return seasons;
  }

  // ... [Keep daily challenge automation methods] ...
  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const kids = await this.prisma.kid.findMany({
      where: { isDeleted: false },
    });
    let totalAssigned = 0;
    for (const kid of kids) {
      let kidAge = 0;
      if (kid.ageRange) {
        const match = kid.ageRange.match(/(\d+)/);
        if (match) kidAge = parseInt(match[1], 10);
      }
      const stories = await this.prisma.story.findMany({
        where: {
          ageMin: { lte: kidAge },
          ageMax: { gte: kidAge },
          isDeleted: false,
        },
      });
      if (stories.length === 0) continue;
      const pastAssignments =
        await this.prisma.dailyChallengeAssignment.findMany({
          where: { kidId: kid.id },
          include: { challenge: true },
        });
      const usedStoryIds = new Set(
        pastAssignments.map(
          (a: DailyChallengeAssignment & { challenge: DailyChallenge }) =>
            a.challenge.storyId,
        ),
      );
      const availableStories = stories.filter(
        (s: { id: string }) => !usedStoryIds.has(s.id),
      );
      const storyPool =
        availableStories.length > 0 ? availableStories : stories;
      const story = storyPool[Math.floor(Math.random() * storyPool.length)];
      const wordOfTheDay = story.title;
      const description = story.description ?? '';
      const meaning = description
        ? description.split('. ')[0] + (description.includes('.') ? '.' : '')
        : '';
      let challenge = await this.prisma.dailyChallenge.findFirst({
        where: { storyId: story.id, challengeDate: today, isDeleted: false },
      });
      if (!challenge) {
        challenge = await this.prisma.dailyChallenge.create({
          data: {
            storyId: story.id,
            challengeDate: today,
            wordOfTheDay,
            meaning,
          },
        });
      }
      const existingAssignment =
        await this.prisma.dailyChallengeAssignment.findFirst({
          where: { kidId: kid.id, challengeId: challenge.id },
        });
      if (!existingAssignment) {
        await this.prisma.dailyChallengeAssignment.create({
          data: { kidId: kid.id, challengeId: challenge.id },
        });
        this.logger.log(
          `Assigned story '${story.title}' to kid '${kid.name ?? kid.id}' for daily challenge.`,
        );
        totalAssigned++;
      }
    }
    this.logger.log(
      `Daily challenge assignment complete. Total assignments: ${totalAssigned}`,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyChallengeAssignment() {
    await this.assignDailyChallengeToAllKids();
    this.logger.log('Daily challenges assigned to all kids at midnight');
  }

  async getTodaysDailyChallengeAssignment(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const assignment = await this.prisma.dailyChallengeAssignment.findFirst({
      where: {
        kidId,
        challenge: {
          challengeDate: { gte: today, lt: tomorrow },
          isDeleted: false,
        },
      },
      include: { challenge: { include: { story: true } } },
    });
    if (!assignment)
      throw new NotFoundException(
        'No daily challenge assignment found for today',
      );
    return assignment;
  }

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: {
        kidId,
        challenge: {
          challengeDate: { gte: weekStart, lt: weekEnd },
          isDeleted: false,
        },
      },
      include: { challenge: { include: { story: true } } },
      orderBy: { assignedAt: 'asc' },
    });
    return assignments;
  }

  async getStoryById(id: string) {
    const story = await this.prisma.story.findUnique({
      where: { id, isDeleted: false },
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        questions: true,
      },
    });
    if (!story) throw new NotFoundException('Story not found');
    return story;
  }

  async generateStoryWithAI(options: GenerateStoryOptions) {
    // Resolve Season IDs to names if needed for AI context
    if (
      options.seasonIds &&
      options.seasonIds.length > 0 &&
      (!options.seasons || options.seasons.length === 0)
    ) {
      const seasons = await this.prisma.season.findMany({
        where: { id: { in: options.seasonIds }, isDeleted: false },
        select: { name: true },
      });
      options.seasons = seasons.map((s) => s.name);
    }

    // 1. Generate Story Content
    const generatedStory = await this.geminiService.generateStory(options);

    // 2. Persist with Image & Audio
    return this.persistGeneratedStory(
      generatedStory,
      options.creatorKidId,
      options.voiceType,
      options.seasonIds,
    );
  }

  async generateStoryForKid(
    kidId: string,
    themeNames?: string[],
    categoryNames?: string[],
    seasonIds?: string[],
    kidName?: string,
  ) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
      include: { preferredCategories: true, preferredVoice: true },
    });

    if (!kid) {
      throw new NotFoundException(`Kid with id ${kidId} not found`);
    }

    // 1. Setup options (existing logic)
    let ageMin = 4;
    let ageMax = 8;
    if (kid.ageRange && typeof kid.ageRange === 'string') {
      const match = kid.ageRange.match(/(\d+)-?(\d+)?/);
      if (match) {
        ageMin = parseInt(match[1], 10);
        ageMax = match[2] ? parseInt(match[2], 10) : ageMin + 2;
      }
    }

    let themes = themeNames || [];
    if (themes.length === 0) {
      const availableThemes = await this.prisma.theme.findMany({
        where: { isDeleted: false },
      });
      if (availableThemes.length === 0) {
        themes = ['Adventure'];
      } else {
        const randomTheme =
          availableThemes[Math.floor(Math.random() * availableThemes.length)];
        themes = [randomTheme.name];
      }
    }

    let categories = categoryNames || [];
    if (kid.preferredCategories && kid.preferredCategories.length > 0) {
      const prefCategoryNames = kid.preferredCategories.map((c) => c.name);
      categories = [...new Set([...categories, ...prefCategoryNames])];
    }
    if (categories.length === 0) {
      const availableCategories = await this.prisma.category.findMany({
        where: { isDeleted: false },
      });
      if (availableCategories.length === 0) {
        categories = ['General'];
      } else {
        const randomCategory =
          availableCategories[
            Math.floor(Math.random() * availableCategories.length)
          ];
        categories = [randomCategory.name];
      }
    }

    let contextString = '';
    if (kid.excludedTags && kid.excludedTags.length > 0) {
      const exclusions = kid.excludedTags.join(', ');
      contextString = `IMPORTANT: The story must strictly AVOID the following topics, themes, creatures, or elements: ${exclusions}. Ensure the content is safe and comfortable for the child regarding these exclusions.`;
    }

    let voiceType: VoiceType | undefined;
    if (kid.preferredVoice) {
      const voiceName = kid.preferredVoice.name.toUpperCase();
      if (voiceName in VoiceType) {
        voiceType = VoiceType[voiceName as keyof typeof VoiceType];
      } else if (VOICE_TYPE_MIGRATION_MAP[voiceName]) {
        voiceType = VOICE_TYPE_MIGRATION_MAP[voiceName];
      } else if (kid.preferredVoice.elevenLabsVoiceId) {
        const elId = kid.preferredVoice.elevenLabsVoiceId.toUpperCase();
        if (elId in VoiceType) {
          voiceType = VoiceType[elId as keyof typeof VoiceType];
        }
      }
    }

    // Resolve Season IDs to Names for AI Context
    const seasonNames: string[] = [];
    if (seasonIds && seasonIds.length > 0) {
      const seasons = await this.prisma.season.findMany({
        where: { id: { in: seasonIds }, isDeleted: false },
        select: { name: true },
      });
      seasonNames.push(...seasons.map((s) => s.name));
    }

    // Resolve userId for tracking
    let userId: string | undefined;
    if (kidId) {
      const kid = await this.prisma.kid.findUnique({
        where: { id: kidId },
        select: { parentId: true },
      });
      if (kid) userId = kid.parentId;
    }

    const options: GenerateStoryOptions = {
      theme: themes,
      category: categories,
      seasons: seasonNames,
      ageMin,
      ageMax,
      kidName: kidName || kid.name || 'Hero',
      language: 'English',
      additionalContext: contextString,
      creatorKidId: kidId,
      voiceType,
      seasonIds: seasonIds,
      userId, // Pass resolved userId for usage tracking
    };

    this.logger.log(
      `Generating story for ${options.kidName}. Themes: [${themes.join(', ')}].`,
    );

    // 2. Generate Content via AI
    const generatedStory = await this.geminiService.generateStory(options);

    // 3. Persist (with Image & Audio) - calling shared helper
    return this.persistGeneratedStory(
      generatedStory,
      kidId,
      voiceType,
      seasonIds,
    );
  }

  // --- PRIVATE HELPER: PERSIST STORY (Includes Image & Audio Gen) ---
  private async persistGeneratedStory(
    generatedStory: GeneratedStory & { textContent?: string },
    creatorKidId?: string,
    voiceType?: VoiceType,
    seasonIds?: string[],
  ) {
    // Resolve userId for tracking if creatorKidId is present
    let userId: string | undefined;
    if (creatorKidId) {
      const kid = await this.prisma.kid.findUnique({
        where: { id: creatorKidId },
        select: { parentId: true },
      });
      if (kid) userId = kid.parentId;
    }

    // 1. Generate Cover Image (Pollinations → Cloudinary)
    let coverImageUrl = '';
    try {
      this.logger.log(`Generating cover image for "${generatedStory.title}"`);
      coverImageUrl = await this.geminiService.generateStoryImage(
        generatedStory.title,
        generatedStory.description || `A story about ${generatedStory.title}`,
        userId, // Pass userId for tracking
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to generate story image: ${msg}`);
    }

    // 2. Prepare Relations (Categories/Themes)
    const categoryConnect =
      generatedStory.category?.map((c: string) => ({
        where: { name: c },
        create: { name: c, description: 'Auto-generated category' },
      })) || [];

    const themeConnect =
      generatedStory.theme?.map((t: string) => ({
        where: { name: t },
        create: { name: t, description: 'Auto-generated theme' },
      })) || [];

    const textContent =
      generatedStory.content ||
      generatedStory.textContent ||
      generatedStory.description ||
      '';
    const wordCount = textContent
      .split(/\s+/)
      .filter((word: string) => word.length > 0).length;
    const durationSeconds = this.calculateDurationSeconds(wordCount);

    // 3. Create Story Record
    let story = await this.prisma.story.create({
      data: {
        title: generatedStory.title,
        description: generatedStory.description,
        language: generatedStory.language || 'English',
        ageMin: generatedStory.ageMin ?? 4,
        ageMax: generatedStory.ageMax ?? 8,
        isInteractive: false,
        coverImageUrl: coverImageUrl,
        textContent: textContent,
        wordCount: wordCount,
        durationSeconds: durationSeconds,
        audioUrl: '', // Will update momentarily
        creatorKidId: creatorKidId || null, // Allow null for orphan stories
        aiGenerated: true,

        categories: { connectOrCreate: categoryConnect },
        themes: { connectOrCreate: themeConnect },
        seasons:
          seasonIds && seasonIds.length > 0
            ? {
                connect: seasonIds.map((id) => ({ id })),
              }
            : generatedStory.seasons
              ? {
                  connect: generatedStory.seasons.map((s: string) => ({
                    name: s,
                  })),
                }
              : undefined,
      },
      include: { images: true, branches: true, categories: true, themes: true },
    });

    // 4. Generate Audio (TTS)
    if (story.textContent) {
      try {
        this.logger.log(`Generating audio for story ${story.id}`);
        const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
          story.id,
          story.textContent,
          voiceType ?? DEFAULT_VOICE,
        );

        // Update story with audio URL
        story = await this.prisma.story.update({
          where: { id: story.id },
          data: { audioUrl },
          include: {
            images: true,
            branches: true,
            categories: true,
            themes: true,
            seasons: true,
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to generate audio for story ${story.id}: ${msg}`,
        );
      }
    }

    await this.invalidateStoryCaches();

    return story;
  }

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!story || !kid || story.wordCount === 0) return;
    const minutes = totalTimeSeconds / 60;
    const wpm = minutes > 0 ? story.wordCount / minutes : 0;
    let newLevel = kid.currentReadingLevel;
    if (wpm > 120 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.min(10, kid.currentReadingLevel + 1);
    } else if (wpm < 40 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.max(1, kid.currentReadingLevel - 1);
    }
    if (newLevel !== kid.currentReadingLevel) {
      await this.prisma.kid.update({
        where: { id: kidId },
        data: { currentReadingLevel: newLevel },
      });
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }

  async getContinueReading(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const progressRecords = await this.withCursorErrorHandling(() =>
      this.prisma.storyProgress.findMany({
        where: {
          kidId,
          progress: { gte: 0 },
          completed: false,
          isDeleted: false,
          story: { isDeleted: false },
        },
        orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
        include: {
          story: {
            include: { categories: true },
          },
        },
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: progressRecords.map((r) => this.mapProgressRecord(r)),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      progressRecords,
      take,
    );
    return { data: data.map((r) => this.mapProgressRecord(r)), pagination };
  }

  async getCompletedStories(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const records = await this.withCursorErrorHandling(() =>
      this.prisma.storyProgress.findMany({
        where: {
          kidId,
          completed: true,
          isDeleted: false,
          story: { isDeleted: false },
        },
        orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
        include: {
          story: {
            include: { categories: true },
          },
        },
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: records.map((r) => r.story),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      records,
      take,
    );
    return { data: data.map((r) => r.story), pagination };
  }

  async getCreatedStories(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const stories = await this.withCursorErrorHandling(() =>
      this.prisma.story.findMany({
        where: { creatorKidId: kidId, isDeleted: false },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: stories,
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    return PaginationUtil.buildCursorResponse(stories, take);
  }

  async getDownloads(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const downloads = await this.withCursorErrorHandling(() =>
      this.prisma.downloadedStory.findMany({
        where: { kidId },
        include: { story: true },
        orderBy: [{ downloadedAt: 'desc' }, { id: 'asc' }],
        ...(useCursor ? { take: take + 1 } : {}),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (!useCursor) {
      return {
        data: downloads.map((d) => d.story),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      downloads,
      take,
    );
    return { data: data.map((d) => d.story), pagination };
  }

  async addDownload(kidId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.downloadedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: { kidId, storyId },
      update: { downloadedAt: new Date() },
    });
  }

  async removeDownload(kidId: string, storyId: string) {
    try {
      return await this.prisma.downloadedStory.delete({
        where: { kidId_storyId: { kidId, storyId } },
      });
    } catch {
      return { message: 'Download removed' };
    }
  }

  async removeFromLibrary(kidId: string, storyId: string) {
    return await this.prisma.$transaction([
      this.prisma.favorite.deleteMany({ where: { kidId, storyId } }),
      this.prisma.downloadedStory.deleteMany({ where: { kidId, storyId } }),
      this.prisma.storyProgress.deleteMany({ where: { kidId, storyId } }),
    ]);
  }

  async recommendStoryToKid(
    userId: string,
    dto: ParentRecommendationDto,
  ): Promise<RecommendationResponseDto> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, parentId: userId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const isRestricted = await this.prisma.restrictedStory.findUnique({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
    });

    if (isRestricted) {
      throw new BadRequestException(
        'This story is currently restricted for this kid. Please unrestrict it first.',
      );
    }

    const existing = await this.prisma.parentRecommendation.findUnique({
      where: {
        userId_kidId_storyId: {
          userId,
          kidId: dto.kidId,
          storyId: dto.storyId,
        },
      },
    });
    if (existing) {
      if (existing.isDeleted) {
        const restored = await this.prisma.parentRecommendation.update({
          where: { id: existing.id },
          data: { isDeleted: false, deletedAt: null, message: dto.message },
          include: {
            story: true,
            user: { select: { id: true, name: true, email: true } },
            kid: { select: { id: true, name: true } },
          },
        });
        return this.toRecommendationResponse(restored);
      }
      throw new BadRequestException(
        `You have already recommended this story to ${kid.name}`,
      );
    }
    const recommendation = await this.prisma.parentRecommendation.create({
      data: {
        userId,
        kidId: dto.kidId,
        storyId: dto.storyId,
        message: dto.message,
      },
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
    });
    return this.toRecommendationResponse(recommendation);
  }

  async getKidRecommendations(
    kidId: string,
    userId: string,
  ): Promise<RecommendationResponseDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, parentId: userId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const recommendations = await this.prisma.parentRecommendation.findMany({
      where: { kidId, isDeleted: false },
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
      orderBy: { recommendedAt: 'desc' },
    });
    return recommendations.map((rec) => this.toRecommendationResponse(rec));
  }

  async deleteRecommendation(
    recommendationId: string,
    userId: string,
    permanent: boolean = false,
  ) {
    const recommendation = await this.prisma.parentRecommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!recommendation)
      throw new NotFoundException('Recommendation not found');
    if (recommendation.userId !== userId)
      throw new ForbiddenException('Access denied');
    if (permanent) {
      return this.prisma.parentRecommendation.delete({
        where: { id: recommendationId },
      });
    } else {
      return this.prisma.parentRecommendation.update({
        where: { id: recommendationId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }
  }

  async getRecommendationStats(
    kidId: string,
    userId: string,
  ): Promise<RecommendationsStatsDto> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, parentId: userId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const totalCount = await this.prisma.parentRecommendation.count({
      where: { kidId, isDeleted: false },
    });
    return { totalCount };
  }

  private toRecommendationResponse(
    recommendation: ParentRecommendation & {
      story?: Record<string, unknown>;
      user?: { id: string; name?: string | null; email?: string };
      kid?: { id: string; name?: string | null };
    },
  ): RecommendationResponseDto {
    return {
      id: recommendation.id,
      userId: recommendation.userId,
      kidId: recommendation.kidId,
      storyId: recommendation.storyId,
      message: recommendation.message ?? undefined,
      recommendedAt: recommendation.recommendedAt,
      story: recommendation.story as CreateStoryDto | undefined,
      user: recommendation.user,
      kid: recommendation.kid,
    };
  }

  async getTopPicksFromParents(limit: number = 10) {
    const topStories = await this.prisma.parentRecommendation.groupBy({
      by: ['storyId'],
      where: { isDeleted: false },
      _count: { storyId: true },
      orderBy: { _count: { storyId: 'desc' } },
      take: limit,
    });

    if (topStories.length === 0) {
      return [];
    }

    const storyIds = topStories.map((s) => s.storyId);
    const stories = await this.prisma.story.findMany({
      where: { id: { in: storyIds }, isDeleted: false },
      include: {
        themes: true,
        categories: true,
        images: true,
      },
    });

    const countMap = new Map(
      topStories.map((s) => [s.storyId, s._count.storyId]),
    );
    return stories
      .map((story) => ({
        ...story,
        recommendationCount: countMap.get(story.id) || 0,
      }))
      .sort((a, b) => b.recommendationCount - a.recommendationCount);
  }

  /**
   * Get random story IDs using raw SQL for efficiency.
   * Only suitable for single-page results (page 1) because ORDER BY RANDOM()
   * produces a different ordering on each call, causing overlapping pages.
   * @param limit - Maximum number of IDs to return
   * @returns Array of random story IDs
   */
  private async getRandomStoryIds(limit: number): Promise<string[]> {
    const randomIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "stories"
      WHERE "isDeleted" = false
      ORDER BY RANDOM()
      LIMIT ${limit}
    `;

    return randomIds.map((r) => r.id);
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
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "stories"
      WHERE "isDeleted" = false
      ORDER BY "createdAt" DESC, id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return ids.map((r) => r.id);
  }

  /**
   * Get random stories for "Top Picks from Us" homepage section.
   * Results are cached for 24 hours.
   */
  async getTopPicksFromUs(limit: number = 10) {
    const sanitizedLimit = PaginationUtil.sanitizeLimit(limit, {
      defaultValue: 10,
      min: 1,
      max: 50,
    });

    const randomIds = await this.getRandomStoryIds(sanitizedLimit);

    if (randomIds.length === 0) {
      return [];
    }

    // Fetch full story objects with relations
    return this.prisma.story.findMany({
      where: { id: { in: randomIds } },
      include: {
        themes: true,
        categories: true,
        images: true,
      },
    });
  }
}
