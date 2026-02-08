import { PrismaService } from '../prisma/prisma.service';
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
  Voice,
  DailyChallengeAssignment,
  Category,
  Theme,
  DailyChallenge,
} from '@prisma/client';
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
import { GeminiService, GenerateStoryOptions } from './gemini.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { VoiceType } from '../voice/dto/voice.dto';
import { DEFAULT_VOICE } from '../voice/voice.constants';
import { STORY_INVALIDATION_KEYS } from '@/shared/constants/cache-keys.constants';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);
  // Average reading speed for children: ~150 words per minute
  private readonly WORDS_PER_MINUTE = 150;

  /** Invalidate all story-related caches */
  private async invalidateStoryCaches(): Promise<void> {
    try {
      await Promise.all(STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)));
    } catch (error) {
      this.logger.warn(`Failed to invalidate story caches: ${error.message}`);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly geminiService: GeminiService,
  ) { }

  /**
   * Calculate estimated reading duration in seconds based on text content or word count
   */
  calculateDurationSeconds(textOrWordCount: string | number): number {
    const wordCount = typeof textOrWordCount === 'string'
      ? textOrWordCount.split(/\s+/).filter(word => word.length > 0).length
      : textOrWordCount;

    if (wordCount <= 0) return 0;

    // Convert words per minute to seconds: (wordCount / wordsPerMinute) * 60
    return Math.ceil((wordCount / this.WORDS_PER_MINUTE) * 60);
  }

  async getStories(filter: {
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
    page?: number;
    limit?: number;
  }): Promise<PaginatedStoriesDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 12;
    const skip = (page - 1) * limit;

    const where: any = {
      isDeleted: false,
    };

    if (filter.theme) where.themes = { some: { id: filter.theme } };
    if (filter.category) {
      where.categories = { some: { id: filter.category } };
    }
    // Seasonal Filter (Dynamic based on date)
    if (filter.isSeasonal) {
      const { activeSeasons, backfillSeasons } = await this.getRelevantSeasons();
      const seasonIds = [...activeSeasons.map(s => s.id)];

      if (backfillSeasons.length > 0) {
        seasonIds.push(...backfillSeasons.map(s => s.id));
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
        recommendedStoryIds = kid.parentRecommendations.map((rec) => rec.storyId);
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
    if ((filter.minAge !== undefined || filter.maxAge !== undefined) && !targetLevel) {
      // Overlap logic: story.ageMin <= filter.maxAge AND story.ageMax >= filter.minAge
      if (filter.minAge !== undefined) {
        where.ageMax = { ...where.ageMax, gte: filter.minAge };
      }
      if (filter.maxAge !== undefined) {
        where.ageMin = { ...where.ageMin, lte: filter.maxAge };
      }
    }

    if (recommendedStoryIds.length > 0 && filter.recommended === undefined) {
      const recommendedClause: any = { id: { in: recommendedStoryIds } };

      // If seasonal filter is active, enforce it on recommended stories too
      if (filter.isSeasonal && where.seasons) {
        recommendedClause.seasons = where.seasons;
      }

      where.OR = [
        { ...where },
        recommendedClause,
      ];
    }

    // Exclude restricted stories (already fetched in batch query above)
    if (restrictedStoryIds.length > 0) {
      where.id = { notIn: restrictedStoryIds, ...where.id };
    }

    if (filter.recommended === true && filter.kidId) {
      where.id = { in: recommendedStoryIds };
    }

    const orderBy = filter.isMostLiked
      ? [
        { parentFavorites: { _count: 'desc' as const } },
        { createdAt: 'desc' as const },
        { id: 'asc' as const },
      ]
      : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    // Run count and findMany in parallel to reduce latency by ~50%
    const [totalCount, stories] = await Promise.all([
      this.prisma.story.count({ where }),
      this.prisma.story.findMany({
        where,
        skip,
        take: limit,
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
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return {
      data: stories,
      pagination: {
        currentPage: page,
        totalPages,
        pageSize: limit,
        totalCount,
      },
    };
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
      if (activeSeasons.find(active => active.id === s.id)) return false;
      if (!s.startDate || !s.endDate) return false;

      const [endMonth, endDay] = s.endDate.split('-').map(Number);

      let seasonEndDate = new Date(today.getFullYear(), endMonth - 1, endDay);

      const diffTime = today.getTime() - seasonEndDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= this.RECENT_SEASON_THRESHOLD_DAYS) {
        return true;
      }

      if (diffDays < 0) {
        const lastYearEnd = new Date(today.getFullYear() - 1, endMonth - 1, endDay);
        const diffLastYear = Math.ceil((today.getTime() - lastYearEnd.getTime()) / (1000 * 60 * 60 * 24));
        if (diffLastYear >= 0 && diffLastYear <= this.RECENT_SEASON_THRESHOLD_DAYS) {
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      include: { preferredCategories: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 1. Recommended Stories (based on preferred categories)
    let recommended: any[] = [];
    if (user.preferredCategories.length > 0) {
      recommended = await this.prisma.story.findMany({
        where: {
          isDeleted: false,
          categories: {
            some: {
              id: { in: user.preferredCategories.map((c: Category) => c.id) },
            },
          },
        },
        take: limitRecommended,
        include: { images: true, categories: true },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
      });
    } else {
      // Fallback if no preferences: just fresh stories
      recommended = await this.prisma.story.findMany({
        where: { isDeleted: false },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        take: limitRecommended,
        include: { images: true, categories: true },
      });
    }

    // 2. Seasonal Stories (Logic: find active season based on today's date)
    const { activeSeasons, backfillSeasons } = await this.getRelevantSeasons();

    let seasonal: any[] = [];
    let seasonalCount = 0;

    if (activeSeasons.length > 0) {
      seasonal = await this.prisma.story.findMany({
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

      const backfillStories = await this.prisma.story.findMany({
        where: {
          isDeleted: false,
          seasons: {
            some: {
              id: { in: backfillSeasons.map(s => s.id) }
            }
          },
          id: { notIn: Array.from(existingIds) }
        },
        take: needed,
        include: { images: true, themes: true, seasons: true },
        orderBy: { createdAt: 'desc' }
      });

      seasonal = [...seasonal, ...backfillStories];
    }

    // 3. Top Liked by Parents
    const topLiked = await this.prisma.story.findMany({
      where: { isDeleted: false },
      orderBy: {
        parentFavorites: {
          _count: 'desc',
        },
      },
      take: limitTopLiked,
      include: { images: true },
    });

    return {
      recommended,
      seasonal,
      topLiked,
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

    let audioUrl = data.audioUrl;

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
        categories: data.categoryIds ? { connect: data.categoryIds.map((id) => ({ id })) } : undefined,
        themes: data.themeIds ? { connect: data.themeIds.map((id) => ({ id })) } : undefined,
        seasons: data.seasonIds
          ? { connect: data.seasonIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { images: true, branches: true },
    });

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
    const story = await this.prisma.story.findUnique({ where: { id, isDeleted: false } });
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
    const story = await this.prisma.story.findUnique({ where: { id: storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyImage.create({ data: { ...image, storyId } });
  }

  async addBranch(storyId: string, branch: StoryBranchDto) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyBranch.create({ data: { ...branch, storyId } });
  }

  async addFavorite(dto: FavoriteDto) {
    const kid = await this.prisma.kid.findUnique({ where: { id: dto.kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.favorite.create({ data: { kidId: dto.kidId, storyId: dto.storyId } });
  }

  async removeFavorite(kidId: string, storyId: string) {
    return await this.prisma.favorite.deleteMany({ where: { kidId, storyId } });
  }

  async getFavorites(kidId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    return await this.prisma.favorite.findMany({ where: { kidId }, include: { story: true } });
  }

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    const kid = await this.prisma.kid.findUnique({ where: { id: dto.kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
    });

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.prisma.storyProgress.upsert({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
      update: {
        progress: dto.progress,
        completed: dto.completed ?? false,
        lastAccessed: new Date(),
        totalTimeSpent: newTotalTime,
      },
      create: {
        kidId: dto.kidId,
        storyId: dto.storyId,
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: sessionTime,
      },
    });

    if (dto.completed && (!existing || !existing.completed)) {
      this.adjustReadingLevel(dto.kidId, dto.storyId, newTotalTime).catch((e) =>
        this.logger.error(`Failed to adjust reading level: ${e.message}`),
      );
    }
    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({ where: { id: storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyProgress.findUnique({ where: { kidId_storyId: { kidId, storyId } } });
  }

  // --- USER STORY PROGRESS (Parent/User - non-kid specific) ---

  async setUserProgress(userId: string, dto: UserStoryProgressDto): Promise<UserStoryProgressResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId, isDeleted: false } });
    if (!user) throw new NotFoundException('User not found');
    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
    });

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.prisma.userStoryProgress.upsert({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
      update: {
        progress: dto.progress,
        completed: dto.completed ?? false,
        lastAccessed: new Date(),
        totalTimeSpent: newTotalTime,
      },
      create: {
        userId,
        storyId: dto.storyId,
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: sessionTime,
      },
    });

    return {
      id: result.id,
      storyId: result.storyId,
      progress: result.progress,
      completed: result.completed,
      lastAccessed: result.lastAccessed,
      totalTimeSpent: result.totalTimeSpent,
    };
  }

  async getUserProgress(userId: string, storyId: string): Promise<UserStoryProgressResponseDto | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId, isDeleted: false } });
    if (!user) throw new NotFoundException('User not found');
    const story = await this.prisma.story.findUnique({ where: { id: storyId, isDeleted: false } });
    if (!story) throw new NotFoundException('Story not found');

    const progress = await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId } },
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

  async getUserContinueReading(userId: string) {
    const progressRecords = await this.prisma.userStoryProgress.findMany({
      where: { userId, progress: { gt: 0 }, completed: false, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });

    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getUserCompletedStories(userId: string) {
    const records = await this.prisma.userStoryProgress.findMany({
      where: { userId, completed: true, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });

    return records.map((r) => r.story);
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    return await this.prisma.$transaction([
      this.prisma.parentFavorite.deleteMany({ where: { userId, storyId } }),
      this.prisma.userStoryProgress.deleteMany({ where: { userId, storyId } }),
    ]);
  }

  async restrictStory(dto: RestrictStoryDto & { userId: string }) {
    const kid = await this.prisma.kid.findUnique({ where: { id: dto.kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');

    // Ensure parent owns the kid
    if (kid.parentId !== dto.userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
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
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
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
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
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
    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
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

  private toDailyChallengeAssignmentDto(assignment: any): DailyChallengeAssignmentDto {
    return {
      id: assignment.id,
      kidId: assignment.kidId,
      challengeId: assignment.challengeId,
      completed: assignment.completed,
      completedAt: assignment.completedAt ?? undefined,
      assignedAt: assignment.assignedAt,
    };
  }

  async assignDailyChallenge(dto: AssignDailyChallengeDto): Promise<DailyChallengeAssignmentDto> {
    const kid = await this.prisma.kid.findUnique({ where: { id: dto.kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const challenge = await this.prisma.dailyChallenge.findUnique({ where: { id: dto.challengeId, isDeleted: false } });
    if (!challenge) throw new NotFoundException('Daily challenge not found');

    const assignment = await this.prisma.dailyChallengeAssignment.create({
      data: { kidId: dto.kidId, challengeId: dto.challengeId },
    });
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async completeDailyChallenge(dto: CompleteDailyChallengeDto): Promise<DailyChallengeAssignmentDto> {
    const assignment = await this.prisma.dailyChallengeAssignment.update({
      where: { id: dto.assignmentId },
      data: { completed: true, completedAt: new Date() },
    });
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async getAssignmentsForKid(kidId: string): Promise<DailyChallengeAssignmentDto[]> {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({ where: { kidId } });
    return assignments.map((a: DailyChallengeAssignment) => this.toDailyChallengeAssignmentDto(a));
  }

  async getAssignmentById(id: string): Promise<DailyChallengeAssignmentDto | null> {
    const assignment = await this.prisma.dailyChallengeAssignment.findUnique({ where: { id } });
    return assignment ? this.toDailyChallengeAssignmentDto(assignment) : null;
  }



  async getStoryAudioUrl(storyId: string, voiceId: VoiceType | string, userId?: string): Promise<string> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
      select: { textContent: true },
    });
    if (!story) throw new NotFoundException(`Story with ID ${storyId} not found`);

    // voiceId can be an enum or a uuid string
    const cachedAudio = await this.prisma.storyAudioCache.findFirst({
      where: { storyId, voiceType: voiceId }, // Schema still calls it voiceType
    });
    if (cachedAudio) return cachedAudio.audioUrl;

    const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
      storyId,
      story?.textContent ?? '',
      voiceId,
      userId,
    );
    await this.prisma.storyAudioCache.create({
      data: { storyId, voiceType: voiceId, audioUrl },
    });
    return audioUrl;
  }

  private toStoryPathDto(path: any): StoryPathDto {
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
    const kid = await this.prisma.kid.findUnique({ where: { id: dto.kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
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
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
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
    const themes = await this.prisma.theme.findMany({ where: { isDeleted: false } });
    return themes.map((t: Theme) => ({
      ...t,
      image: t.image ?? undefined,
      description: t.description ?? undefined,
    }));
  }

  async getSeasons() {
    const seasons = await this.prisma.season.findMany({
      where: { isDeleted: false },
      orderBy: { startDate: 'asc' }
    });
    return seasons;
  }

  // ... [Keep daily challenge automation methods] ...
  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const kids = await this.prisma.kid.findMany({ where: { isDeleted: false } });
    let totalAssigned = 0;
    for (const kid of kids) {
      let kidAge = 0;
      if (kid.ageRange) {
        const match = kid.ageRange.match(/(\d+)/);
        if (match) kidAge = parseInt(match[1], 10);
      }
      const stories = await this.prisma.story.findMany({
        where: { ageMin: { lte: kidAge }, ageMax: { gte: kidAge }, isDeleted: false },
      });
      if (stories.length === 0) continue;
      const pastAssignments = await this.prisma.dailyChallengeAssignment.findMany({
        where: { kidId: kid.id },
        include: { challenge: true },
      });
      const usedStoryIds = new Set(
        pastAssignments.map((a: DailyChallengeAssignment & { challenge: DailyChallenge }) => a.challenge.storyId),
      );
      const availableStories = stories.filter((s: any) => !usedStoryIds.has(s.id));
      const storyPool = availableStories.length > 0 ? availableStories : stories;
      const story = storyPool[Math.floor(Math.random() * storyPool.length)];
      const wordOfTheDay = story.title;
      const meaning = story.description.split('. ')[0] + (story.description.includes('.') ? '.' : '');
      let challenge = await this.prisma.dailyChallenge.findFirst({
        where: { storyId: story.id, challengeDate: today, isDeleted: false },
      });
      if (!challenge) {
        challenge = await this.prisma.dailyChallenge.create({
          data: { storyId: story.id, challengeDate: today, wordOfTheDay, meaning },
        });
      }
      const existingAssignment = await this.prisma.dailyChallengeAssignment.findFirst({
        where: { kidId: kid.id, challengeId: challenge.id },
      });
      if (!existingAssignment) {
        await this.prisma.dailyChallengeAssignment.create({
          data: { kidId: kid.id, challengeId: challenge.id },
        });
        this.logger.log(`Assigned story '${story.title}' to kid '${kid.name ?? kid.id}' for daily challenge.`);
        totalAssigned++;
      }
    }
    this.logger.log(`Daily challenge assignment complete. Total assignments: ${totalAssigned}`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyChallengeAssignment() {
    await this.assignDailyChallengeToAllKids();
    this.logger.log('Daily challenges assigned to all kids at midnight');
  }

  async getTodaysDailyChallengeAssignment(kidId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const assignment = await this.prisma.dailyChallengeAssignment.findFirst({
      where: {
        kidId,
        challenge: { challengeDate: { gte: today, lt: tomorrow }, isDeleted: false },
      },
      include: { challenge: { include: { story: true } } },
    });
    if (!assignment) throw new NotFoundException('No daily challenge assignment found for today');
    return assignment;
  }

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: {
        kidId,
        challenge: { challengeDate: { gte: weekStart, lt: weekEnd }, isDeleted: false },
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
    if (options.seasonIds && options.seasonIds.length > 0 && (!options.seasons || options.seasons.length === 0)) {
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
      options.kidName || 'Hero',
      options.creatorKidId,
      options.voiceType,
      options.seasonIds
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
      const availableThemes = await this.prisma.theme.findMany({ where: { isDeleted: false } });
      const randomTheme = availableThemes[Math.floor(Math.random() * availableThemes.length)];
      themes = [randomTheme.name];
    }

    let categories = categoryNames || [];
    if (kid.preferredCategories && kid.preferredCategories.length > 0) {
      const prefCategoryNames = kid.preferredCategories.map((c) => c.name);
      categories = [...new Set([...categories, ...prefCategoryNames])];
    }
    if (categories.length === 0) {
      const availableCategories = await this.prisma.category.findMany({ where: { isDeleted: false } });
      const randomCategory = availableCategories[Math.floor(Math.random() * availableCategories.length)];
      categories = [randomCategory.name];
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
      `Generating story for ${options.kidName}. Themes: [${themes.join(', ')}].`
    );

    // 2. Generate Content via AI
    const generatedStory = await this.geminiService.generateStory(options);

    // 3. Persist (with Image & Audio) - calling shared helper
    return this.persistGeneratedStory(
      generatedStory,
      options.kidName!,
      kidId,
      voiceType,
      seasonIds
    );
  }

  // --- PRIVATE HELPER: PERSIST STORY (Includes Image & Audio Gen) ---
  private async persistGeneratedStory(
    generatedStory: any,
    kidName: string,
    creatorKidId?: string,
    voiceType?: VoiceType,
    seasonIds?: string[]
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

    // 1. Generate Cover Image (Pollinations)
    let coverImageUrl = '';
    try {
      this.logger.log(`Generating cover image for "${generatedStory.title}"`);
      coverImageUrl = await this.geminiService.generateStoryImage(
        generatedStory.title,
        generatedStory.description || `A story about ${generatedStory.title}`,
        userId // Pass userId for tracking
      );
    } catch (e) {
      this.logger.error(`Failed to generate story image: ${e.message}`);
    }

    // 2. Prepare Relations (Categories/Themes)
    const categoryConnect = generatedStory.category?.map((c: string) => ({
      where: { name: c },
      create: { name: c, description: 'Auto-generated category' },
    })) || [];

    const themeConnect = generatedStory.theme?.map((t: string) => ({
      where: { name: t },
      create: { name: t, description: 'Auto-generated theme' },
    })) || [];

    const textContent = generatedStory.content || generatedStory.textContent || generatedStory.description || '';
    const wordCount = textContent.split(/\s+/).filter((word: string) => word.length > 0).length;
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
                connect: generatedStory.seasons.map((s: string) => ({ name: s })),
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
          voiceType ?? DEFAULT_VOICE
        );

        // Update story with audio URL
        story = await this.prisma.story.update({
          where: { id: story.id },
          data: { audioUrl },
          include: { images: true, branches: true, categories: true, themes: true, seasons: true },
        });
      } catch (error) {
        this.logger.error(`Failed to generate audio for story ${story.id}: ${error.message}`);
      }
    }

    await this.invalidateStoryCaches();

    return story;
  }

  private async adjustReadingLevel(kidId: string, storyId: string, totalTimeSeconds: number) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId, isDeleted: false } });
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, isDeleted: false } });
    if (!story || !kid || story.wordCount === 0) return;
    const minutes = totalTimeSeconds / 60;
    const wpm = minutes > 0 ? story.wordCount / minutes : 0;
    let newLevel = kid.currentReadingLevel;
    if (wpm > 120 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.min(10, kid.currentReadingLevel + 1);
    }
    else if (wpm < 40 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.max(1, kid.currentReadingLevel - 1);
    }
    if (newLevel !== kid.currentReadingLevel) {
      await this.prisma.kid.update({ where: { id: kidId }, data: { currentReadingLevel: newLevel } });
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }

  async getContinueReading(kidId: string) {
    const progressRecords = await this.prisma.storyProgress.findMany({
      where: { kidId, progress: { gt: 0 }, completed: false, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });
    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getCompletedStories(kidId: string) {
    const records = await this.prisma.storyProgress.findMany({
      where: { kidId, completed: true, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });
    return records.map(r => r.story);
  }

  async getCreatedStories(kidId: string) {
    return await this.prisma.story.findMany({
      where: { creatorKidId: kidId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloads(kidId: string) {
    const downloads = await this.prisma.downloadedStory.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { downloadedAt: 'desc' },
    });
    return downloads.map((d) => d.story);
  }

  async addDownload(kidId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.downloadedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: { kidId, storyId },
      update: { downloadedAt: new Date() },
    });
  }

  async removeDownload(kidId: string, storyId: string) {
    try {
      return await this.prisma.downloadedStory.delete({ where: { kidId_storyId: { kidId, storyId } } });
    } catch (error) {
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

  async recommendStoryToKid(userId: string, dto: ParentRecommendationDto): Promise<RecommendationResponseDto> {
    const kid = await this.prisma.kid.findUnique({ where: { id: dto.kidId, parentId: userId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const story = await this.prisma.story.findUnique({ where: { id: dto.storyId, isDeleted: false } });
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
      where: { userId_kidId_storyId: { userId, kidId: dto.kidId, storyId: dto.storyId } },
    });
    if (existing) {
      if (existing.isDeleted) {
        const restored = await this.prisma.parentRecommendation.update({
          where: { id: existing.id },
          data: { isDeleted: false, deletedAt: null, message: dto.message },
          include: { story: true, user: { select: { id: true, name: true, email: true } }, kid: { select: { id: true, name: true } } },
        });
        return this.toRecommendationResponse(restored);
      }
      throw new BadRequestException(`You have already recommended this story to ${kid.name}`);
    }
    const recommendation = await this.prisma.parentRecommendation.create({
      data: { userId, kidId: dto.kidId, storyId: dto.storyId, message: dto.message },
      include: { story: true, user: { select: { id: true, name: true, email: true } }, kid: { select: { id: true, name: true } } },
    });
    return this.toRecommendationResponse(recommendation);
  }

  async getKidRecommendations(kidId: string, userId: string): Promise<RecommendationResponseDto[]> {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, parentId: userId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const recommendations = await this.prisma.parentRecommendation.findMany({
      where: { kidId, isDeleted: false },
      include: { story: true, user: { select: { id: true, name: true, email: true } }, kid: { select: { id: true, name: true } } },
      orderBy: { recommendedAt: 'desc' },
    });
    return recommendations.map((rec) => this.toRecommendationResponse(rec));
  }

  async deleteRecommendation(recommendationId: string, userId: string, permanent: boolean = false) {
    const recommendation = await this.prisma.parentRecommendation.findUnique({ where: { id: recommendationId } });
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    if (recommendation.userId !== userId) throw new ForbiddenException('Access denied');
    if (permanent) {
      return this.prisma.parentRecommendation.delete({ where: { id: recommendationId } });
    } else {
      return this.prisma.parentRecommendation.update({
        where: { id: recommendationId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }
  }

  async getRecommendationStats(kidId: string, userId: string): Promise<RecommendationsStatsDto> {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId, parentId: userId, isDeleted: false } });
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const totalCount = await this.prisma.parentRecommendation.count({ where: { kidId, isDeleted: false } });
    return { totalCount };
  }

  private toRecommendationResponse(recommendation: any): RecommendationResponseDto {
    return {
      id: recommendation.id,
      userId: recommendation.userId,
      kidId: recommendation.kidId,
      storyId: recommendation.storyId,
      message: recommendation.message ?? undefined,
      recommendedAt: recommendation.recommendedAt,
      story: recommendation.story,
      user: recommendation.user,
      kid: recommendation.kid,
    };
  }

  async getTopPicksFromParents(limit: number = 10): Promise<any[]> {
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

    const countMap = new Map(topStories.map((s) => [s.storyId, s._count.storyId]));
    return stories
      .map((story) => ({
        ...story,
        recommendationCount: countMap.get(story.id) || 0,
      }))
      .sort((a, b) => b.recommendationCount - a.recommendationCount);
  }

  /**
   * Get random stories for "Top Picks from Us" homepage section.
   * Results are cached for 24 hours.
   */
  async getTopPicksFromUs(limit: number = 10): Promise<any[]> {
    // Get random story IDs using raw SQL for efficiency
    const randomIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Story"
      WHERE "isDeleted" = false
      ORDER BY RANDOM()
      LIMIT ${limit}
    `;

    if (randomIds.length === 0) {
      return [];
    }

    // Fetch full story objects with relations
    return this.prisma.story.findMany({
      where: { id: { in: randomIds.map((r) => r.id) } },
      include: {
        themes: true,
        categories: true,
        images: true,
      },
    });
  }
}