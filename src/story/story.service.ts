import {
  STORY_REPOSITORY,
  IStoryRepository,
} from './repositories/story.repository.interface';
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
import { DailyChallengeAssignment, DailyChallenge } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GenerateStoryOptions } from './gemini.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { STORY_INVALIDATION_KEYS } from '@/shared/constants/cache-keys.constants';
import {
  DEFAULT_CURSOR_LIMIT,
  PaginationUtil,
} from '@/shared/utils/pagination.util';
import { StoryFavoriteService } from './story-favorite.service';
import { StoryDownloadService } from './story-download.service';
import { StoryPathService } from './story-path.service';
import { StoryMetadataService } from './story-metadata.service';
import { StoryProgressService } from './story-progress.service';
import { StoryRecommendationService } from './story-recommendation.service';
import { DailyChallengeService } from './daily-challenge.service';
import { StoryFeedService } from './story-feed.service';
import { StoryGenerationService } from './story-generation.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);
  // Average reading speed for children: ~150 words per minute
  private readonly WORDS_PER_MINUTE = 150;

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
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    public readonly uploadService: UploadService,
    private readonly storyGenerationService: StoryGenerationService,
    private readonly storyFavoriteService: StoryFavoriteService,
    private readonly storyDownloadService: StoryDownloadService,
    private readonly storyPathService: StoryPathService,
    private readonly storyMetadataService: StoryMetadataService,
    private readonly storyProgressService: StoryProgressService,
    private readonly storyRecommendationService: StoryRecommendationService,
    private readonly dailyChallengeService: DailyChallengeService,
    private readonly storyFeedService: StoryFeedService,
    // NotificationModule is @Global; StoryModule already imports it too.
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
    return this.storyFeedService.getStories(filter);
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
    return this.storyFeedService.getStoriesCursor(filter);
  }

  async usesSeasonalOrdering(filter: {
    category?: string;
    isSeasonal?: boolean;
  }): Promise<boolean> {
    return this.storyFeedService.usesSeasonalOrdering(filter);
  }

  async getHomePageStories(
    userId: string | undefined,
    limitRecommended: number = 5,
    limitSeasonal: number = 5,
    limitTopLiked: number = 5,
  ) {
    return this.storyFeedService.getHomePageStories(
      userId,
      limitRecommended,
      limitSeasonal,
      limitTopLiked,
    );
  }

  async createStory(data: CreateStoryDto) {
    if (data.categoryIds && data.categoryIds.length > 0) {
      const categories = await this.storyRepository.findManyCategoriesRaw({
        where: { id: { in: data.categoryIds } },
      });
      if (categories.length !== data.categoryIds.length) {
        throw new BadRequestException('One or more categories not found');
      }
    }

    const audioUrl = data.audioUrl;

    const story = await this.storyRepository.createStoryRaw({
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
    const story = await this.storyRepository.findUniqueStoryRaw({
      where: { id, isDeleted: false },
    });

    if (!story) throw new NotFoundException('Story not found');

    const updatedStory = await this.storyRepository.updateStoryRaw({
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
    const story = await this.storyRepository.findUniqueStoryRaw({
      where: { id, ...(permanent ? {} : { isDeleted: false }) },
    });
    if (!story) throw new NotFoundException('Story not found');

    let result;
    if (permanent) {
      result = await this.storyRepository.deleteStoryRaw({ where: { id } });
    } else {
      result = await this.storyRepository.updateStoryRaw({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }

    await this.invalidateStoryCaches();
    return result;
  }

  async undoDeleteStory(id: string) {
    const story = await this.storyRepository.findUniqueStoryRaw({
      where: { id },
    });
    if (!story) throw new NotFoundException('Story not found');
    if (!story.isDeleted) throw new BadRequestException('Story is not deleted');

    const result = await this.storyRepository.updateStoryRaw({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });

    await this.invalidateStoryCaches();
    return result;
  }

  async addImage(storyId: string, image: StoryImageDto) {
    return this.storyMetadataService.addImage(storyId, image);
  }

  async addBranch(storyId: string, branch: StoryBranchDto) {
    return this.storyMetadataService.addBranch(storyId, branch);
  }

  async addFavorite(dto: FavoriteDto) {
    return this.storyFavoriteService.addFavorite(dto);
  }

  async removeFavorite(kidId: string, storyId: string) {
    return this.storyFavoriteService.removeFavorite(kidId, storyId);
  }

  async getFavorites(kidId: string, cursor?: string, limit?: number) {
    return this.storyFavoriteService.getFavorites(kidId, cursor, limit);
  }

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    return this.storyProgressService.setProgress(dto);
  }

  async getProgress(kidId: string, storyId: string) {
    return this.storyProgressService.getProgress(kidId, storyId);
  }

  // --- USER STORY PROGRESS (Parent/User - non-kid specific) ---

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    return this.storyProgressService.setUserProgress(userId, dto);
  }

  async getUserProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgressResponseDto | null> {
    return this.storyProgressService.getUserProgress(userId, storyId);
  }

  async getUserContinueReading(
    userId: string,
    cursor?: string,
    limit?: number,
  ) {
    return this.storyProgressService.getUserContinueReading(
      userId,
      cursor,
      limit,
    );
  }

  async getUserCompletedStories(
    userId: string,
    cursor?: string,
    limit?: number,
  ) {
    return this.storyProgressService.getUserCompletedStories(
      userId,
      cursor,
      limit,
    );
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    return this.storyProgressService.removeFromUserLibrary(userId, storyId);
  }

  async restrictStory(dto: RestrictStoryDto & { userId: string }) {
    return this.storyRecommendationService.restrictStory(dto);
  }

  async unrestrictStory(kidId: string, storyId: string, userId: string) {
    return this.storyRecommendationService.unrestrictStory(
      kidId,
      storyId,
      userId,
    );
  }

  async getRestrictedStories(kidId: string, userId: string) {
    return this.storyRecommendationService.getRestrictedStories(kidId, userId);
  }

  async setDailyChallenge(dto: DailyChallengeDto) {
    return this.dailyChallengeService.setDailyChallenge(dto);
  }

  async getDailyChallenge(date: string) {
    return this.dailyChallengeService.getDailyChallenge(date);
  }

  async assignDailyChallenge(
    dto: AssignDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    return this.dailyChallengeService.assignDailyChallenge(dto);
  }

  async completeDailyChallenge(
    dto: CompleteDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    return this.dailyChallengeService.completeDailyChallenge(dto);
  }

  async getAssignmentsForKid(
    kidId: string,
  ): Promise<DailyChallengeAssignmentDto[]> {
    return this.dailyChallengeService.getAssignmentsForKid(kidId);
  }

  async getAssignmentById(
    id: string,
  ): Promise<DailyChallengeAssignmentDto | null> {
    return this.dailyChallengeService.getAssignmentById(id);
  }

  async startStoryPath(dto: StartStoryPathDto): Promise<StoryPathDto> {
    return this.storyPathService.startStoryPath(dto);
  }

  async updateStoryPath(dto: UpdateStoryPathDto): Promise<StoryPathDto> {
    return this.storyPathService.updateStoryPath(dto);
  }

  async getStoryPathsForKid(kidId: string): Promise<StoryPathDto[]> {
    return this.storyPathService.getStoryPathsForKid(kidId);
  }

  async getStoryPathById(id: string): Promise<StoryPathDto | null> {
    return this.storyPathService.getStoryPathById(id);
  }

  async getCategories(): Promise<CategoryDto[]> {
    return this.storyMetadataService.getCategories();
  }

  async getThemes(): Promise<ThemeDto[]> {
    return this.storyMetadataService.getThemes();
  }

  async getSeasons() {
    return this.storyMetadataService.getSeasons();
  }

  // ... [Keep daily challenge automation methods] ...
  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const kids = await this.storyRepository.findManyKidsRaw({
      where: { isDeleted: false },
    });
    let totalAssigned = 0;
    for (const kid of kids) {
      let kidAge = 0;
      if (kid.ageRange) {
        const match = kid.ageRange.match(/(\d+)/);
        if (match) kidAge = parseInt(match[1], 10);
      }
      const stories = await this.storyRepository.findManyStoriesRaw({
        where: {
          ageMin: { lte: kidAge },
          ageMax: { gte: kidAge },
          isDeleted: false,
          isPublished: true,
        },
      });
      if (stories.length === 0) continue;
      const pastAssignments =
        await this.storyRepository.findManyDailyChallengeAssignmentsRaw({
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
      let challenge = await this.storyRepository.findFirstDailyChallengeRaw({
        where: { storyId: story.id, challengeDate: today, isDeleted: false },
      });
      if (!challenge) {
        challenge = await this.storyRepository.createDailyChallengeRaw({
          data: {
            storyId: story.id,
            challengeDate: today,
            wordOfTheDay,
            meaning,
          },
        });
      }
      const existingAssignment =
        await this.storyRepository.findFirstDailyChallengeAssignmentRaw({
          where: { kidId: kid.id, challengeId: challenge.id },
        });
      if (!existingAssignment) {
        await this.storyRepository.createDailyChallengeAssignmentRaw({
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
    return this.dailyChallengeService.getTodaysDailyChallengeAssignment(kidId);
  }

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    return this.dailyChallengeService.getWeeklyDailyChallengeAssignments(
      kidId,
      weekStart,
    );
  }

  async getStoryById(id: string) {
    const story = await this.storyRepository.findUniqueStoryRaw({
      where: { id, isDeleted: false, isPublished: true },
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

  /**
   * Delegates to the canonical {@link StoryGenerationService} so that the
   * synchronous controller path and the async BullMQ processor path produce
   * identical stories (atomic persist + STORY_CREATED event + TTS).
   */
  async generateStoryWithAI(options: GenerateStoryOptions) {
    return this.storyGenerationService.generateStoryWithAI(options);
  }

  /**
   * Delegates to the canonical {@link StoryGenerationService} — see
   * {@link generateStoryWithAI} for the rationale behind unifying both paths.
   */
  async generateStoryForKid(
    kidId: string,
    themeNames?: string[],
    categoryNames?: string[],
    seasonIds?: string[],
    kidName?: string,
  ) {
    return this.storyGenerationService.generateStoryForKid(
      kidId,
      themeNames,
      categoryNames,
      seasonIds,
      kidName,
    );
  }

  async getContinueReading(kidId: string, cursor?: string, limit?: number) {
    return this.storyProgressService.getContinueReading(kidId, cursor, limit);
  }

  async getCompletedStories(kidId: string, cursor?: string, limit?: number) {
    return this.storyProgressService.getCompletedStories(kidId, cursor, limit);
  }

  async getCreatedStories(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const stories = await this.withCursorErrorHandling(() =>
      this.storyRepository.findManyStoriesRaw({
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
    return this.storyDownloadService.getDownloads(kidId, cursor, limit);
  }

  async addDownload(kidId: string, storyId: string) {
    const story = await this.storyRepository.findUniqueStoryRaw({
      // Reject a known draft id: a draft can't be added to a kid's library.
      where: { id: storyId, isDeleted: false, isPublished: true },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.storyRepository.upsertDownload(kidId, storyId);
  }

  async removeDownload(kidId: string, storyId: string) {
    return this.storyDownloadService.removeDownload(kidId, storyId);
  }

  async removeFromLibrary(kidId: string, storyId: string) {
    return await this.storyRepository.removeFromLibraryTransaction(
      kidId,
      storyId,
    );
  }

  async recommendStoryToKid(
    userId: string,
    dto: ParentRecommendationDto,
  ): Promise<RecommendationResponseDto> {
    return this.storyRecommendationService.recommendStoryToKid(userId, dto);
  }

  async getKidRecommendations(
    kidId: string,
    userId: string,
  ): Promise<RecommendationResponseDto[]> {
    return this.storyRecommendationService.getKidRecommendations(kidId, userId);
  }

  async deleteRecommendation(
    recommendationId: string,
    userId: string,
    permanent: boolean = false,
  ) {
    return this.storyRecommendationService.deleteRecommendation(
      recommendationId,
      userId,
      permanent,
    );
  }

  async getRecommendationStats(
    kidId: string,
    userId: string,
  ): Promise<RecommendationsStatsDto> {
    return this.storyRecommendationService.getRecommendationStats(
      kidId,
      userId,
    );
  }

  async getTopPicksFromParents(limit: number = 10) {
    const topStories =
      await this.storyRepository.groupParentRecommendationsByStory(limit);

    if (topStories.length === 0) {
      return [];
    }

    const storyIds = topStories.map((s) => s.storyId);
    const stories = await this.storyRepository.findManyStoriesRaw({
      where: { id: { in: storyIds }, isDeleted: false, isPublished: true },
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
    return this.storyRepository.getRandomStoryIdsFromStories(limit);
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
    return this.storyRepository.findManyStoriesRaw({
      where: { id: { in: randomIds }, isPublished: true },
      include: {
        themes: true,
        categories: true,
        images: true,
      },
    });
  }
}
