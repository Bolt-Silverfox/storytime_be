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
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';

import { UploadService } from '../upload/upload.service';
import {
  StoryPath,
  DailyChallengeAssignment,
  Theme,
  DailyChallenge,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TextToSpeechService } from './text-to-speech.service';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StoryRecommendationService } from './story-recommendation.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { VoiceType } from '../voice/dto/voice.dto';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
  STORY_INVALIDATION_KEYS,
} from '@/shared/constants/cache-keys.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppEvents,
  StoryCreatedEvent,
  StoryCompletedEvent,
} from '@/shared/events';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  /** Invalidate all story-related caches */
  private async invalidateStoryCaches(): Promise<void> {
    try {
      await Promise.all(
        STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)),
      );
    } catch (error) {
      this.logger.warn(`Failed to invalidate story caches: ${error.message}`);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    @Inject(forwardRef(() => StoryRecommendationService))
    private readonly storyRecommendationService: StoryRecommendationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getStories(filter: {
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
  }): Promise<PaginatedStoriesDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 12;
    const skip = (page - 1) * limit;

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
        await this.storyRecommendationService.getRelevantSeasons();
      const seasonIds = [...activeSeasons.map((s: { id: string }) => s.id)];

      if (backfillSeasons.length > 0) {
        seasonIds.push(...backfillSeasons.map((s: { id: string }) => s.id));
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

    // Handle topPicksFromUs filter - get random stories using shared helper
    if (filter.topPicksFromUs) {
      const randomStoryIds = await this.storyRecommendationService.getRandomStoryIds(limit, skip);

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
    const [totalCount, stories] = await Promise.all([
      filter.topPicksFromUs
        ? this.prisma.story.count({ where: { isDeleted: false } })
        : this.prisma.story.count({ where }),
      this.prisma.story.findMany({
        where,
        ...(filter.topPicksFromUs ? {} : { skip, take: limit }),
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

  async createStory(data: CreateStoryDto) {
    const audioUrl = data.audioUrl;

    // Use transaction to ensure category validation and story creation are atomic
    const story = await this.prisma.$transaction(async (tx) => {
      // Validate categories exist within transaction
      if (data.categoryIds && data.categoryIds.length > 0) {
        const categories = await tx.category.findMany({
          where: { id: { in: data.categoryIds } },
        });
        if (categories.length !== data.categoryIds.length) {
          throw new BadRequestException('One or more categories not found');
        }
      }

      // Validate themes exist within transaction
      if (data.themeIds && data.themeIds.length > 0) {
        const themes = await tx.theme.findMany({
          where: { id: { in: data.themeIds } },
        });
        if (themes.length !== data.themeIds.length) {
          throw new BadRequestException('One or more themes not found');
        }
      }

      // Validate seasons exist within transaction
      if (data.seasonIds && data.seasonIds.length > 0) {
        const seasons = await tx.season.findMany({
          where: { id: { in: data.seasonIds } },
        });
        if (seasons.length !== data.seasonIds.length) {
          throw new BadRequestException('One or more seasons not found');
        }
      }

      return tx.story.create({
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
    });

    await this.invalidateStoryCaches();

    // Emit story created event
    this.eventEmitter.emit(AppEvents.STORY_CREATED, {
      storyId: story.id,
      title: story.title,
      aiGenerated: false, // Manual creation
      createdAt: story.createdAt,
    } satisfies StoryCreatedEvent);

    return story;
  }

  async updateStory(id: string, data: UpdateStoryDto) {
    // Use transaction to ensure validation and update are atomic
    const updatedStory = await this.prisma.$transaction(async (tx) => {
      const story = await tx.story.findUnique({
        where: { id, isDeleted: false },
      });

      if (!story) throw new NotFoundException('Story not found');

      // Validate categories exist within transaction
      if (data.categoryIds && data.categoryIds.length > 0) {
        const categories = await tx.category.findMany({
          where: { id: { in: data.categoryIds } },
        });
        if (categories.length !== data.categoryIds.length) {
          throw new BadRequestException('One or more categories not found');
        }
      }

      // Validate themes exist within transaction
      if (data.themeIds && data.themeIds.length > 0) {
        const themes = await tx.theme.findMany({
          where: { id: { in: data.themeIds } },
        });
        if (themes.length !== data.themeIds.length) {
          throw new BadRequestException('One or more themes not found');
        }
      }

      // Validate seasons exist within transaction
      if (data.seasonIds && data.seasonIds.length > 0) {
        const seasons = await tx.season.findMany({
          where: { id: { in: data.seasonIds } },
        });
        if (seasons.length !== data.seasonIds.length) {
          throw new BadRequestException('One or more seasons not found');
        }
      }

      return tx.story.update({
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
    });

    await this.invalidateStoryCaches();
    return updatedStory;
  }

  async deleteStory(id: string, permanent: boolean = false) {
    const story = await this.prisma.story.findUnique({
      where: { id, isDeleted: false },
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
    // Batch validation queries
    const [kid, story] = await Promise.all([
      this.prisma.kid.findUnique({
        where: { id: dto.kidId, isDeleted: false },
      }),
      this.prisma.story.findUnique({
        where: { id: dto.storyId, isDeleted: false },
      }),
    ]);

    if (!kid) throw new NotFoundException('Kid not found');
    if (!story) throw new NotFoundException('Story not found');

    return await this.prisma.favorite.create({
      data: { kidId: dto.kidId, storyId: dto.storyId },
    });
  }

  async removeFavorite(kidId: string, storyId: string) {
    return await this.prisma.favorite.deleteMany({ where: { kidId, storyId } });
  }

  async getFavorites(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    return await this.prisma.favorite.findMany({
      where: { kidId },
      include: { story: true },
    });
  }

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    // Batch all validation and lookup queries
    const [kid, story, existing] = await Promise.all([
      this.prisma.kid.findUnique({
        where: { id: dto.kidId, isDeleted: false },
      }),
      this.prisma.story.findUnique({
        where: { id: dto.storyId, isDeleted: false },
      }),
      this.prisma.storyProgress.findUnique({
        where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
      }),
    ]);

    if (!kid) throw new NotFoundException('Kid not found');
    if (!story) throw new NotFoundException('Story not found');

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

      // Emit story completed event
      this.eventEmitter.emit(AppEvents.STORY_COMPLETED, {
        storyId: dto.storyId,
        kidId: dto.kidId,
        totalTimeSpent: newTotalTime,
        completedAt: new Date(),
      } satisfies StoryCompletedEvent);
    }
    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    // Batch validation and data retrieval
    const [kid, story, progress] = await Promise.all([
      this.prisma.kid.findUnique({
        where: { id: kidId, isDeleted: false },
      }),
      this.prisma.story.findUnique({
        where: { id: storyId, isDeleted: false },
      }),
      this.prisma.storyProgress.findUnique({
        where: { kidId_storyId: { kidId, storyId } },
      }),
    ]);

    if (!kid) throw new NotFoundException('Kid not found');
    if (!story) throw new NotFoundException('Story not found');

    return progress;
  }

  // --- USER STORY PROGRESS (Parent/User - non-kid specific) ---

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    // Batch all validation and lookup queries
    const [user, story, existing] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId, isDeleted: false },
      }),
      this.prisma.story.findUnique({
        where: { id: dto.storyId, isDeleted: false },
      }),
      this.prisma.userStoryProgress.findUnique({
        where: { userId_storyId: { userId, storyId: dto.storyId } },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!story) throw new NotFoundException('Story not found');

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

  async getUserProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgressResponseDto | null> {
    // Batch validation and data retrieval
    const [user, story, progress] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId, isDeleted: false },
      }),
      this.prisma.story.findUnique({
        where: { id: storyId, isDeleted: false },
      }),
      this.prisma.userStoryProgress.findUnique({
        where: { userId_storyId: { userId, storyId } },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!story) throw new NotFoundException('Story not found');
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
      where: {
        userId,
        progress: { gt: 0 },
        completed: false,
        isDeleted: false,
      },
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
    // Batch validation queries
    const [kid, challenge] = await Promise.all([
      this.prisma.kid.findUnique({
        where: { id: dto.kidId, isDeleted: false },
      }),
      this.prisma.dailyChallenge.findUnique({
        where: { id: dto.challengeId, isDeleted: false },
      }),
    ]);

    if (!kid) throw new NotFoundException('Kid not found');
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

  async getStoryAudioUrl(
    storyId: string,
    voiceId: VoiceType | string,
    userId?: string,
  ): Promise<string> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
      select: { textContent: true },
    });
    if (!story)
      throw new NotFoundException(`Story with ID ${storyId} not found`);

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
    // Batch validation queries
    const [kid, story] = await Promise.all([
      this.prisma.kid.findUnique({
        where: { id: dto.kidId, isDeleted: false },
      }),
      this.prisma.story.findUnique({
        where: { id: dto.storyId, isDeleted: false },
      }),
    ]);

    if (!kid) throw new NotFoundException('Kid not found');
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
    // Try cache first
    const cached = await this.cacheManager.get<CategoryDto[]>(
      CACHE_KEYS.CATEGORIES_ALL,
    );
    if (cached) {
      return cached;
    }

    this.logger.log('Fetching categories with story counts from database');
    const categories = await this.prisma.category.findMany({
      where: { isDeleted: false },
      include: { _count: { select: { stories: true } } },
    });
    const result = categories.map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image ?? undefined,
      description: c.description ?? undefined,
      storyCount: c._count.stories,
    }));

    // Cache for 1 hour
    await this.cacheManager.set(
      CACHE_KEYS.CATEGORIES_ALL,
      result,
      CACHE_TTL_MS.STATIC_CONTENT,
    );

    return result;
  }

  async getThemes(): Promise<ThemeDto[]> {
    // Try cache first
    const cached = await this.cacheManager.get<ThemeDto[]>(
      CACHE_KEYS.THEMES_ALL,
    );
    if (cached) {
      return cached;
    }

    const themes = await this.prisma.theme.findMany({
      where: { isDeleted: false },
    });
    const result = themes.map((t: Theme) => ({
      ...t,
      image: t.image ?? undefined,
      description: t.description ?? undefined,
    }));

    // Cache for 1 hour
    await this.cacheManager.set(
      CACHE_KEYS.THEMES_ALL,
      result,
      CACHE_TTL_MS.STATIC_CONTENT,
    );

    return result;
  }

  async getSeasons() {
    // Try cache first
    const cached = await this.cacheManager.get(CACHE_KEYS.SEASONS_ALL);
    if (cached) {
      return cached;
    }

    const seasons = await this.prisma.season.findMany({
      where: { isDeleted: false },
      orderBy: { startDate: 'asc' },
    });

    // Cache for 1 hour
    await this.cacheManager.set(
      CACHE_KEYS.SEASONS_ALL,
      seasons,
      CACHE_TTL_MS.STATIC_CONTENT,
    );

    return seasons;
  }

  // --- Daily Challenge Assignment (Optimized to avoid N+1) ---
  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Batch fetch all data upfront to avoid N+1 queries
    const [kids, allStories, allPastAssignments, todaysChallenges] =
      await Promise.all([
        this.prisma.kid.findMany({
          where: { isDeleted: false },
        }),
        this.prisma.story.findMany({
          where: { isDeleted: false },
          select: { id: true, title: true, description: true, ageMin: true, ageMax: true },
        }),
        this.prisma.dailyChallengeAssignment.findMany({
          include: { challenge: true },
        }),
        this.prisma.dailyChallenge.findMany({
          where: { challengeDate: today, isDeleted: false },
        }),
      ]);

    // Build lookup maps for O(1) access
    const pastAssignmentsByKid = new Map<string, Set<string>>();
    for (const assignment of allPastAssignments) {
      if (!pastAssignmentsByKid.has(assignment.kidId)) {
        pastAssignmentsByKid.set(assignment.kidId, new Set());
      }
      pastAssignmentsByKid.get(assignment.kidId)!.add(assignment.challenge.storyId);
    }

    const challengesByStoryId = new Map<string, DailyChallenge>();
    for (const challenge of todaysChallenges) {
      challengesByStoryId.set(challenge.storyId, challenge);
    }

    // Track which kid-challenge pairs already exist
    const existingAssignmentPairs = new Set(
      allPastAssignments
        .filter((a) => todaysChallenges.some((c) => c.id === a.challengeId))
        .map((a) => `${a.kidId}-${a.challengeId}`),
    );

    let totalAssigned = 0;
    const newChallenges: Array<{
      storyId: string;
      challengeDate: Date;
      wordOfTheDay: string;
      meaning: string;
    }> = [];
    const newAssignments: Array<{ kidId: string; storyId: string }> = [];

    for (const kid of kids) {
      // Parse kid age
      let kidAge = 0;
      if (kid.ageRange) {
        const match = kid.ageRange.match(/(\d+)/);
        if (match) kidAge = parseInt(match[1], 10);
      }

      // Filter stories by age in memory (avoid per-kid query)
      const ageAppropriateStories = allStories.filter(
        (s) => s.ageMin <= kidAge && s.ageMax >= kidAge,
      );
      if (ageAppropriateStories.length === 0) continue;

      // Get used story IDs from map
      const usedStoryIds = pastAssignmentsByKid.get(kid.id) || new Set();
      const availableStories = ageAppropriateStories.filter(
        (s) => !usedStoryIds.has(s.id),
      );
      const storyPool =
        availableStories.length > 0 ? availableStories : ageAppropriateStories;
      const story = storyPool[Math.floor(Math.random() * storyPool.length)];

      // Check if challenge exists for this story today
      let challenge = challengesByStoryId.get(story.id);
      if (!challenge) {
        // Queue for batch creation
        const description = story.description ?? '';
        const meaning = description
          ? description.split('. ')[0] + (description.includes('.') ? '.' : '')
          : '';
        newChallenges.push({
          storyId: story.id,
          challengeDate: today,
          wordOfTheDay: story.title,
          meaning,
        });
      }

      // Queue assignment for this kid
      newAssignments.push({ kidId: kid.id, storyId: story.id });
    }

    // Batch create new challenges
    if (newChallenges.length > 0) {
      await this.prisma.dailyChallenge.createMany({
        data: newChallenges,
        skipDuplicates: true,
      });

      // Refresh challenges map after creation
      const refreshedChallenges = await this.prisma.dailyChallenge.findMany({
        where: { challengeDate: today, isDeleted: false },
      });
      for (const challenge of refreshedChallenges) {
        challengesByStoryId.set(challenge.storyId, challenge);
      }
    }

    // Batch create assignments
    const assignmentsToCreate: Array<{ kidId: string; challengeId: string }> = [];
    for (const { kidId, storyId } of newAssignments) {
      const challenge = challengesByStoryId.get(storyId);
      if (!challenge) continue;

      const pairKey = `${kidId}-${challenge.id}`;
      if (!existingAssignmentPairs.has(pairKey)) {
        assignmentsToCreate.push({ kidId, challengeId: challenge.id });
        existingAssignmentPairs.add(pairKey);
        totalAssigned++;
      }
    }

    if (assignmentsToCreate.length > 0) {
      await this.prisma.dailyChallengeAssignment.createMany({
        data: assignmentsToCreate,
        skipDuplicates: true,
      });
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

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    // Batch queries for story and kid
    const [story, kid] = await Promise.all([
      this.prisma.story.findUnique({
        where: { id: storyId, isDeleted: false },
      }),
      this.prisma.kid.findUnique({
        where: { id: kidId, isDeleted: false },
      }),
    ]);

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
    return records.map((r) => r.story);
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
}
