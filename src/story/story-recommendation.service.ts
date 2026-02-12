import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  STORY_CORE_REPOSITORY,
  IStoryCoreRepository,
} from './repositories/story-core.repository.interface';
import {
  STORY_METADATA_REPOSITORY,
  IStoryMetadataRepository,
} from './repositories/story-metadata.repository.interface';
import {
  STORY_RECOMMENDATION_REPOSITORY,
  IStoryRecommendationRepository,
} from './repositories/story-recommendation.repository.interface';
import {
  CreateStoryDto,
  ParentRecommendationDto,
  RecommendationResponseDto,
  RecommendationsStatsDto,
  RestrictStoryDto,
} from './dto/story.dto';
import type { Category, ParentRecommendation } from '@prisma/client';
import { PaginationUtil } from '@/shared/utils/pagination.util';

@Injectable()
export class StoryRecommendationService {
  private readonly logger = new Logger(StoryRecommendationService.name);

  // Threshold in days to consider a past season as "recent" for backfill
  private readonly RECENT_SEASON_THRESHOLD_DAYS = 45;

  constructor(
    @Inject(STORY_CORE_REPOSITORY)
    private readonly storyCoreRepository: IStoryCoreRepository,
    @Inject(STORY_METADATA_REPOSITORY)
    private readonly storyMetadataRepository: IStoryMetadataRepository,
    @Inject(STORY_RECOMMENDATION_REPOSITORY)
    private readonly storyRecommendationRepository: IStoryRecommendationRepository,
  ) { }

  // =====================
  // HOME PAGE RECOMMENDATIONS
  // =====================

  async getRelevantSeasons() {
    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate(); // 1-31
    const currentDateStr = `${currentMonth
      .toString()
      .padStart(2, '0')}-${currentDay.toString().padStart(2, '0')}`;

    const allSeasons = await this.storyMetadataRepository.findAllSeasons();

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
    userId: string,
    limitRecommended: number = 5,
    limitSeasonal: number = 5,
    limitTopLiked: number = 5,
  ) {
    // First, get user with preferences (required for recommended stories)
    const user =
      await this.storyCoreRepository.findUserByIdWithPreferences(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Build recommended query based on user preferences
    const recommendedWhere =
      user.preferredCategories.length > 0
        ? {
          isDeleted: false,
          categories: {
            some: {
              id: { in: user.preferredCategories.map((c: Category) => c.id) },
            },
          },
        }
        : { isDeleted: false };

    // Run independent queries in parallel for better performance
    // Note: 'findStories' is in Core Repo
    // 'getRelevantSeasons' is local (uses Metadata Repo)
    // Top Liked needs 'parentFavorites' count logic. Does Core Repo support this?
    // IStoryCoreRepository.findStories supports Prisma.StoryWhereInput/OrderBy.
    // Yes, provided the input object is valid Prisma input.
    const [recommended, { activeSeasons, backfillSeasons }, topLiked] =
      await Promise.all([
        // 1. Recommended Stories (based on preferred categories)
        this.storyCoreRepository.findStories({
          where: recommendedWhere,
          take: limitRecommended,
          include: { images: true, categories: true },
          orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        }),
        // 2. Get relevant seasons (runs in parallel)
        this.getRelevantSeasons(),
        // 3. Top Liked by Parents (independent, runs in parallel)
        this.storyCoreRepository.findStories({
          where: { isDeleted: false },
          orderBy: {
            parentFavorites: {
              _count: 'desc',
            },
          } as any, // Cast to any if strict typing complains about Deep Relations in OrderBy
          take: limitTopLiked,
          include: { images: true },
        }),
      ]);

    // Sequential: Get seasonal stories (depends on seasons result)
    let seasonal: Awaited<ReturnType<typeof this.storyCoreRepository.findStories>> =
      [];

    if (activeSeasons.length > 0) {
      seasonal = await this.storyCoreRepository.findStories({
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
    }

    // Backfill if needed (depends on seasonal results)
    if (seasonal.length < limitSeasonal && backfillSeasons.length > 0) {
      const needed = limitSeasonal - seasonal.length;
      const existingIds = new Set(seasonal.map((s) => s.id));

      const backfillStories = await this.storyCoreRepository.findStories({
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

    return {
      recommended,
      seasonal,
      topLiked,
    };
  }

  // =====================
  // STORY RESTRICTIONS
  // =====================

  async restrictStory(dto: RestrictStoryDto & { userId: string }) {
    // Batch validation queries
    const [kid, story] = await Promise.all([
      this.storyCoreRepository.findKidById(dto.kidId),
      this.storyCoreRepository.findStoryById(dto.storyId),
    ]);

    if (!kid) throw new NotFoundException('Kid not found');
    if (!story) throw new NotFoundException('Story not found');

    // Ensure parent owns the kid
    if (kid.parentId !== dto.userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    return await this.storyCoreRepository.restrictStory(
      dto.kidId,
      dto.storyId,
      dto.userId,
      dto.reason,
    );
  }

  async unrestrictStory(kidId: string, storyId: string, userId: string) {
    const kid = await this.storyCoreRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const restriction = await this.storyCoreRepository.findRestrictedStory(
      kidId,
      storyId,
    );

    if (!restriction) {
      throw new NotFoundException('Story is not restricted for this kid');
    }

    return await this.storyCoreRepository.unrestrictStory(kidId, storyId);
  }

  async getRestrictedStories(kidId: string, userId: string) {
    const kid = await this.storyCoreRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const restricted =
      await this.storyCoreRepository.findRestrictedStories(kidId);

    return restricted.map((r) => ({
      ...r.story,
      restrictionReason: r.reason,
      restrictedAt: r.createdAt,
    }));
  }

  // =====================
  // PARENT RECOMMENDATIONS
  // =====================

  async recommendStoryToKid(
    userId: string,
    dto: ParentRecommendationDto,
  ): Promise<RecommendationResponseDto> {
    // Batch all validation and lookup queries
    const [kid, story, isRestricted, existing] = await Promise.all([
      this.storyCoreRepository.findKidByIdAndParent(dto.kidId, userId),
      this.storyCoreRepository.findStoryById(dto.storyId),
      this.storyCoreRepository.findRestrictedStory(dto.kidId, dto.storyId),
      this.storyRecommendationRepository.findParentRecommendation(
        userId,
        dto.kidId,
        dto.storyId,
      ),
    ]);

    if (!kid) throw new NotFoundException('Kid not found or access denied');
    if (!story) throw new NotFoundException('Story not found');

    if (isRestricted) {
      throw new BadRequestException(
        'This story is currently restricted for this kid. Please unrestrict it first.',
      );
    }
    if (existing) {
      if (existing.isDeleted) {
        const restored = await this.storyRecommendationRepository.updateParentRecommendation(
          existing.id,
          { isDeleted: false, deletedAt: null, message: dto.message },
        );
        return this.toRecommendationResponse(restored);
      }
      throw new BadRequestException(
        `You have already recommended this story to ${kid.name}`,
      );
    }
    const recommendation =
      await this.storyRecommendationRepository.createParentRecommendation(
        userId,
        dto.kidId,
        dto.storyId,
        dto.message,
      );
    return this.toRecommendationResponse(recommendation);
  }

  async getKidRecommendations(
    kidId: string,
    userId: string,
  ): Promise<RecommendationResponseDto[]> {
    const kid = await this.storyCoreRepository.findKidByIdAndParent(kidId, userId);
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const recommendations =
      await this.storyRecommendationRepository.findParentRecommendationsByKidId(kidId);
    return recommendations.map((rec) => this.toRecommendationResponse(rec));
  }

  async deleteRecommendation(
    recommendationId: string,
    userId: string,
    permanent: boolean = false,
  ) {
    const recommendation =
      await this.storyRecommendationRepository.findParentRecommendationById(recommendationId);
    if (!recommendation)
      throw new NotFoundException('Recommendation not found');
    if (recommendation.userId !== userId)
      throw new ForbiddenException('Access denied');
    if (permanent) {
      return this.storyRecommendationRepository.deleteParentRecommendation(recommendationId);
    } else {
      return this.storyRecommendationRepository.updateParentRecommendation(recommendationId, {
        isDeleted: true,
        deletedAt: new Date(),
      });
    }
  }

  async getRecommendationStats(
    kidId: string,
    userId: string,
  ): Promise<RecommendationsStatsDto> {
    const kid = await this.storyCoreRepository.findKidByIdAndParent(kidId, userId);
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const totalCount =
      await this.storyRecommendationRepository.countParentRecommendationsByKidId(kidId);
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

  // =====================
  // TOP PICKS
  // =====================

  async getTopPicksFromParents(limit: number = 10) {
    const topStories =
      await this.storyRecommendationRepository.groupParentRecommendationsByStory(limit);

    if (topStories.length === 0) {
      return [];
    }

    const storyIds = topStories.map((s) => s.storyId);
    const stories = await this.storyCoreRepository.findStories({
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
   * @param limit - Maximum number of IDs to return
   * @param offset - Number of results to skip (for pagination)
   * @returns Array of random story IDs
   */
  async getRandomStoryIds(
    limit: number,
    offset: number = 0,
  ): Promise<string[]> {
    return this.storyCoreRepository.getRandomStoryIds(limit, offset);
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
    return this.storyCoreRepository.findStories({
      where: { id: { in: randomIds } },
      include: {
        themes: true,
        categories: true,
        images: true,
      },
    });
  }
}
