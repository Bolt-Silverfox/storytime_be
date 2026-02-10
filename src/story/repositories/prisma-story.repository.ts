import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  Story,
  StoryImage,
  StoryBranch,
  StoryProgress,
  UserStoryProgress,
  Favorite,
  DailyChallenge,
  DailyChallengeAssignment,
  StoryPath,
  Category,
  Theme,
  Season,
  DownloadedStory,
  RestrictedStory,
  ParentRecommendation,
  StoryAudioCache,
  UserUsage,
  Kid,
  User,
  Voice,
  Prisma,
} from '@prisma/client';
import {
  IStoryRepository,
  StoryWithRelations,
  KidWithPreferences,
  UserWithPreferences,
  DailyChallengeWithStory,
  DailyChallengeAssignmentWithChallenge,
  StoryProgressWithStory,
  UserStoryProgressWithStory,
  DownloadedStoryWithStory,
  RestrictedStoryWithStory,
  ParentRecommendationWithRelations,
  FavoriteWithStory,
  CategoryWithCount,
} from './story.repository.interface';

@Injectable()
export class PrismaStoryRepository implements IStoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== Story CRUD Operations ====================

  async findStoryById(
    id: string,
    includeDeleted = false,
  ): Promise<Story | null> {
    return this.prisma.story.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
    });
  }

  async findStoryByIdWithRelations(
    id: string,
    includeDeleted = false,
  ): Promise<StoryWithRelations | null> {
    return this.prisma.story.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        seasons: true,
        questions: { select: { id: true } },
      },
    });
  }

  async findStories(params: {
    where: Prisma.StoryWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.StoryOrderByWithRelationInput[];
    include?: Prisma.StoryInclude;
  }): Promise<StoryWithRelations[]> {
    const { where, skip, take, orderBy, include } = params;
    return this.prisma.story.findMany({
      where,
      skip,
      take,
      orderBy,
      include: include ?? {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        seasons: true,
        questions: { select: { id: true } },
      },
    }) as Promise<StoryWithRelations[]>;
  }

  async countStories(where: Prisma.StoryWhereInput): Promise<number> {
    return this.prisma.story.count({ where });
  }

  async createStory(
    data: Prisma.StoryCreateInput,
    include?: Prisma.StoryInclude,
  ): Promise<StoryWithRelations> {
    return this.prisma.story.create({
      data,
      include: include ?? {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        seasons: true,
        questions: { select: { id: true } },
      },
    }) as Promise<StoryWithRelations>;
  }

  async updateStory(
    id: string,
    data: Prisma.StoryUpdateInput,
    include?: Prisma.StoryInclude,
  ): Promise<StoryWithRelations> {
    return this.prisma.story.update({
      where: { id },
      data,
      include: include ?? {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        seasons: true,
        questions: { select: { id: true } },
      },
    }) as Promise<StoryWithRelations>;
  }

  async deleteStoryPermanently(id: string): Promise<Story> {
    return this.prisma.story.delete({
      where: { id },
    });
  }

  async softDeleteStory(id: string): Promise<Story> {
    return this.prisma.story.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async restoreStory(id: string): Promise<Story> {
    return this.prisma.story.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  // ==================== Story Image/Branch Operations ====================

  async createStoryImage(
    data: Prisma.StoryImageCreateInput,
  ): Promise<StoryImage> {
    return this.prisma.storyImage.create({ data });
  }

  async createStoryBranch(
    data: Prisma.StoryBranchCreateInput,
  ): Promise<StoryBranch> {
    return this.prisma.storyBranch.create({ data });
  }

  // ==================== Favorite Operations (Kid) ====================

  async createFavorite(kidId: string, storyId: string): Promise<Favorite> {
    return this.prisma.favorite.create({
      data: { kidId, storyId },
    });
  }

  async deleteFavorites(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return this.prisma.favorite.deleteMany({
      where: { kidId, storyId },
    });
  }

  async findFavoritesByKidId(kidId: string): Promise<FavoriteWithStory[]> {
    return this.prisma.favorite.findMany({
      where: { kidId },
      include: { story: true },
    });
  }

  // ==================== Parent Favorite Operations ====================

  async deleteParentFavorites(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return this.prisma.parentFavorite.deleteMany({
      where: { userId, storyId },
    });
  }

  // ==================== Story Progress Operations (Kid) ====================

  async findStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<StoryProgress | null> {
    return this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async upsertStoryProgress(
    kidId: string,
    storyId: string,
    data: {
      progress: number;
      completed: boolean;
      totalTimeSpent?: number;
    },
  ): Promise<StoryProgress> {
    return this.prisma.storyProgress.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: {
        kidId,
        storyId,
        progress: data.progress,
        completed: data.completed,
        totalTimeSpent: data.totalTimeSpent ?? 0,
      },
      update: {
        progress: data.progress,
        completed: data.completed,
        ...(data.totalTimeSpent !== undefined && {
          totalTimeSpent: data.totalTimeSpent,
        }),
        ...(data.completed && { completedAt: new Date() }),
      },
    });
  }

  async findContinueReadingProgress(
    kidId: string,
  ): Promise<StoryProgressWithStory[]> {
    return this.prisma.storyProgress.findMany({
      where: {
        kidId,
        completed: false,
        progress: { gt: 0 },
        isDeleted: false,
      },
      include: { story: true },
      orderBy: { lastAccessed: 'desc' },
    }) as Promise<StoryProgressWithStory[]>;
  }

  async findCompletedProgress(
    kidId: string,
  ): Promise<StoryProgressWithStory[]> {
    return this.prisma.storyProgress.findMany({
      where: {
        kidId,
        completed: true,
        isDeleted: false,
      },
      include: { story: true },
      orderBy: { lastAccessed: 'desc' },
    }) as Promise<StoryProgressWithStory[]>;
  }

  async deleteStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return this.prisma.storyProgress.deleteMany({
      where: { kidId, storyId },
    });
  }

  // ==================== User Story Progress Operations ====================

  async findUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress | null> {
    return this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId } },
    });
  }

  async upsertUserStoryProgress(
    userId: string,
    storyId: string,
    data: {
      progress: number;
      completed: boolean;
      totalTimeSpent?: number;
    },
  ): Promise<UserStoryProgress> {
    return this.prisma.userStoryProgress.upsert({
      where: { userId_storyId: { userId, storyId } },
      create: {
        userId,
        storyId,
        progress: data.progress,
        completed: data.completed,
        totalTimeSpent: data.totalTimeSpent ?? 0,
      },
      update: {
        progress: data.progress,
        completed: data.completed,
        ...(data.totalTimeSpent !== undefined && {
          totalTimeSpent: data.totalTimeSpent,
        }),
        ...(data.completed && { completedAt: new Date() }),
      },
    });
  }

  async findUserContinueReadingProgress(
    userId: string,
  ): Promise<UserStoryProgressWithStory[]> {
    return this.prisma.userStoryProgress.findMany({
      where: {
        userId,
        completed: false,
        progress: { gt: 0 },
        isDeleted: false,
      },
      include: { story: true },
      orderBy: { lastAccessed: 'desc' },
    }) as Promise<UserStoryProgressWithStory[]>;
  }

  async findUserCompletedProgress(
    userId: string,
  ): Promise<UserStoryProgressWithStory[]> {
    return this.prisma.userStoryProgress.findMany({
      where: {
        userId,
        completed: true,
        isDeleted: false,
      },
      include: { story: true },
      orderBy: { lastAccessed: 'desc' },
    }) as Promise<UserStoryProgressWithStory[]>;
  }

  async deleteUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return this.prisma.userStoryProgress.deleteMany({
      where: { userId, storyId },
    });
  }

  async createUserStoryProgressRecord(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress> {
    return this.prisma.userStoryProgress.create({
      data: {
        userId,
        storyId,
        progress: 0,
        completed: false,
        totalTimeSpent: 0,
      },
    });
  }

  // ==================== Daily Challenge Operations ====================

  async createDailyChallenge(
    data: Prisma.DailyChallengeCreateInput,
  ): Promise<DailyChallenge> {
    return this.prisma.dailyChallenge.create({ data });
  }

  async createManyDailyChallenges(
    data: Prisma.DailyChallengeCreateManyInput[],
  ): Promise<{ count: number }> {
    return this.prisma.dailyChallenge.createMany({ data });
  }

  async findDailyChallengesByDate(
    date: Date,
  ): Promise<DailyChallengeWithStory[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.dailyChallenge.findMany({
      where: {
        challengeDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: { story: true },
    }) as Promise<DailyChallengeWithStory[]>;
  }

  async findDailyChallengeByStoryAndDate(
    storyId: string,
    date: Date,
  ): Promise<DailyChallenge | null> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.dailyChallenge.findFirst({
      where: {
        storyId,
        challengeDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });
  }

  // ==================== Daily Challenge Assignment Operations ====================

  async createDailyChallengeAssignment(
    kidId: string,
    challengeId: string,
  ): Promise<DailyChallengeAssignment> {
    return this.prisma.dailyChallengeAssignment.create({
      data: { kidId, challengeId },
    });
  }

  async createManyDailyChallengeAssignments(
    data: { kidId: string; challengeId: string }[],
  ): Promise<{ count: number }> {
    return this.prisma.dailyChallengeAssignment.createMany({ data });
  }

  async updateDailyChallengeAssignment(
    id: string,
    data: Partial<{ completed: boolean; completedAt: Date }>,
  ): Promise<DailyChallengeAssignment> {
    return this.prisma.dailyChallengeAssignment.update({
      where: { id },
      data,
    });
  }

  async findDailyChallengeAssignmentById(
    id: string,
  ): Promise<DailyChallengeAssignment | null> {
    return this.prisma.dailyChallengeAssignment.findUnique({
      where: { id },
    });
  }

  async findDailyChallengeAssignmentsForKid(
    kidId: string,
  ): Promise<DailyChallengeAssignment[]> {
    return this.prisma.dailyChallengeAssignment.findMany({
      where: { kidId },
    });
  }

  async findTodaysDailyChallengeAssignment(
    kidId: string,
    today: Date,
    tomorrow: Date,
  ): Promise<DailyChallengeAssignmentWithChallenge | null> {
    return this.prisma.dailyChallengeAssignment.findFirst({
      where: {
        kidId,
        challenge: {
          challengeDate: {
            gte: today,
            lt: tomorrow,
          },
        },
      },
      include: {
        challenge: {
          include: { story: true },
        },
      },
    }) as Promise<DailyChallengeAssignmentWithChallenge | null>;
  }

  async findWeeklyDailyChallengeAssignments(
    kidId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<DailyChallengeAssignmentWithChallenge[]> {
    return this.prisma.dailyChallengeAssignment.findMany({
      where: {
        kidId,
        challenge: {
          challengeDate: {
            gte: weekStart,
            lte: weekEnd,
          },
        },
      },
      include: {
        challenge: {
          include: { story: true },
        },
      },
      orderBy: {
        assignedAt: 'asc',
      },
    }) as Promise<DailyChallengeAssignmentWithChallenge[]>;
  }

  async findAllDailyChallengeAssignments(): Promise<
    (DailyChallengeAssignment & { challenge: DailyChallenge })[]
  > {
    return this.prisma.dailyChallengeAssignment.findMany({
      include: { challenge: true },
    });
  }

  // ==================== Story Path Operations ====================

  async createStoryPath(kidId: string, storyId: string): Promise<StoryPath> {
    return this.prisma.storyPath.create({
      data: {
        kidId,
        storyId,
        path: JSON.stringify([]),
      },
    });
  }

  async updateStoryPath(
    id: string,
    data: Partial<{ path: string; completedAt: Date | null }>,
  ): Promise<StoryPath> {
    return this.prisma.storyPath.update({
      where: { id },
      data,
    });
  }

  async findStoryPathById(id: string): Promise<StoryPath | null> {
    return this.prisma.storyPath.findUnique({
      where: { id },
    });
  }

  async findStoryPathsByKidId(kidId: string): Promise<StoryPath[]> {
    return this.prisma.storyPath.findMany({
      where: { kidId },
    });
  }

  // ==================== Category/Theme/Season Operations ====================

  async findAllCategories(): Promise<CategoryWithCount[]> {
    return this.prisma.category.findMany({
      include: {
        _count: {
          select: { stories: true },
        },
      },
    });
  }

  async findCategoriesByIds(ids: string[]): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { id: { in: ids } },
    });
  }

  async findAllThemes(): Promise<Theme[]> {
    return this.prisma.theme.findMany();
  }

  async findThemesByIds(ids: string[]): Promise<Theme[]> {
    return this.prisma.theme.findMany({
      where: { id: { in: ids } },
    });
  }

  async findAllSeasons(): Promise<Season[]> {
    return this.prisma.season.findMany();
  }

  async findSeasonsByIds(ids: string[]): Promise<Season[]> {
    return this.prisma.season.findMany({
      where: { id: { in: ids } },
    });
  }

  // ==================== Download Operations ====================

  async findDownloadsByKidId(
    kidId: string,
  ): Promise<DownloadedStoryWithStory[]> {
    return this.prisma.downloadedStory.findMany({
      where: { kidId },
      include: { story: true },
    });
  }

  async upsertDownload(
    kidId: string,
    storyId: string,
  ): Promise<DownloadedStory> {
    return this.prisma.downloadedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: { kidId, storyId },
      update: { downloadedAt: new Date() },
    });
  }

  async deleteDownload(
    kidId: string,
    storyId: string,
  ): Promise<DownloadedStory | null> {
    try {
      return await this.prisma.downloadedStory.delete({
        where: { kidId_storyId: { kidId, storyId } },
      });
    } catch {
      return null;
    }
  }

  async deleteDownloads(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return this.prisma.downloadedStory.deleteMany({
      where: { kidId, storyId },
    });
  }

  // ==================== Restriction Operations ====================

  async upsertRestrictedStory(
    kidId: string,
    storyId: string,
    userId: string,
    reason?: string,
  ): Promise<RestrictedStory> {
    return this.prisma.restrictedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: {
        kidId,
        storyId,
        userId,
        reason,
      },
      update: {
        userId,
        reason,
      },
    });
  }

  async findRestrictedStory(
    kidId: string,
    storyId: string,
  ): Promise<RestrictedStory | null> {
    return this.prisma.restrictedStory.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async deleteRestrictedStory(
    kidId: string,
    storyId: string,
  ): Promise<RestrictedStory> {
    return this.prisma.restrictedStory.delete({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async findRestrictedStoriesByKidId(
    kidId: string,
  ): Promise<RestrictedStoryWithStory[]> {
    return this.prisma.restrictedStory.findMany({
      where: { kidId },
      include: { story: true },
    });
  }

  // ==================== Parent Recommendation Operations ====================

  async findParentRecommendation(
    userId: string,
    kidId: string,
    storyId: string,
  ): Promise<ParentRecommendation | null> {
    return this.prisma.parentRecommendation.findFirst({
      where: {
        userId,
        kidId,
        storyId,
        isDeleted: false,
      },
    });
  }

  async findParentRecommendationById(
    id: string,
  ): Promise<ParentRecommendation | null> {
    return this.prisma.parentRecommendation.findUnique({
      where: { id },
    });
  }

  async createParentRecommendation(
    userId: string,
    kidId: string,
    storyId: string,
    message?: string,
  ): Promise<ParentRecommendationWithRelations> {
    return this.prisma.parentRecommendation.create({
      data: {
        userId,
        kidId,
        storyId,
        message,
      },
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
    });
  }

  async updateParentRecommendation(
    id: string,
    data: Partial<{
      isDeleted: boolean;
      deletedAt: Date | null;
      message: string | null;
    }>,
  ): Promise<ParentRecommendationWithRelations> {
    return this.prisma.parentRecommendation.update({
      where: { id },
      data,
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
    });
  }

  async deleteParentRecommendation(id: string): Promise<ParentRecommendation> {
    return this.prisma.parentRecommendation.delete({
      where: { id },
    });
  }

  async findParentRecommendationsByKidId(
    kidId: string,
  ): Promise<ParentRecommendationWithRelations[]> {
    return this.prisma.parentRecommendation.findMany({
      where: {
        kidId,
        isDeleted: false,
      },
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
      orderBy: { recommendedAt: 'desc' },
    });
  }

  async countParentRecommendationsByKidId(kidId: string): Promise<number> {
    return this.prisma.parentRecommendation.count({
      where: {
        kidId,
        isDeleted: false,
      },
    });
  }

  async groupParentRecommendationsByStory(
    limit: number,
  ): Promise<{ storyId: string; _count: { storyId: number } }[]> {
    const result = await this.prisma.parentRecommendation.groupBy({
      by: ['storyId'],
      _count: { storyId: true },
      where: { isDeleted: false },
      orderBy: { _count: { storyId: 'desc' } },
      take: limit,
    });
    return result;
  }

  // ==================== Audio Cache Operations ====================

  async findStoryAudioCache(
    storyId: string,
    voiceType: string,
  ): Promise<StoryAudioCache | null> {
    return this.prisma.storyAudioCache.findUnique({
      where: { storyId_voiceType: { storyId, voiceType } },
    });
  }

  async createStoryAudioCache(
    storyId: string,
    voiceType: string,
    audioUrl: string,
  ): Promise<StoryAudioCache> {
    return this.prisma.storyAudioCache.create({
      data: {
        storyId,
        voiceType,
        audioUrl,
      },
    });
  }

  // ==================== Usage Tracking Operations ====================

  async findUserUsage(userId: string): Promise<UserUsage | null> {
    return this.prisma.userUsage.findUnique({
      where: { userId },
    });
  }

  async createUserUsage(data: Prisma.UserUsageCreateInput): Promise<UserUsage> {
    return this.prisma.userUsage.create({ data });
  }

  async updateUserUsage(
    userId: string,
    data: Prisma.UserUsageUpdateInput,
  ): Promise<UserUsage> {
    return this.prisma.userUsage.update({
      where: { userId },
      data,
    });
  }

  async upsertUserUsage(
    userId: string,
    createData: Omit<Prisma.UserUsageCreateInput, 'user'>,
    updateData: Prisma.UserUsageUpdateInput,
  ): Promise<UserUsage> {
    return this.prisma.userUsage.upsert({
      where: { userId },
      create: {
        ...createData,
        user: { connect: { id: userId } },
      },
      update: updateData,
    });
  }

  // ==================== Kid Operations ====================

  async findKidById(id: string, includeDeleted = false): Promise<Kid | null> {
    return this.prisma.kid.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
    });
  }

  async findKidByIdAndParent(
    kidId: string,
    parentId: string,
  ): Promise<Kid | null> {
    return this.prisma.kid.findFirst({
      where: {
        id: kidId,
        parentId,
        isDeleted: false,
      },
    });
  }

  async findKidByIdWithPreferences(
    id: string,
  ): Promise<KidWithPreferences | null> {
    return this.prisma.kid.findFirst({
      where: { id, isDeleted: false },
      include: {
        preferredCategories: true,
        parentRecommendations: { select: { storyId: true } },
        restrictedStories: { select: { storyId: true } },
        preferredVoice: true,
      },
    });
  }

  async findAllKids(): Promise<Kid[]> {
    return this.prisma.kid.findMany({
      where: { isDeleted: false },
    });
  }

  async updateKidReadingLevel(kidId: string, newLevel: number): Promise<Kid> {
    return this.prisma.kid.update({
      where: { id: kidId },
      data: { currentReadingLevel: newLevel },
    });
  }

  // ==================== User Operations ====================

  async findUserById(id: string, includeDeleted = false): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
    });
  }

  async findUserByIdWithPreferences(
    id: string,
  ): Promise<UserWithPreferences | null> {
    return this.prisma.user.findFirst({
      where: { id, isDeleted: false },
      include: {
        preferredCategories: true,
      },
    });
  }

  // ==================== Voice Operations ====================

  async findVoiceById(id: string): Promise<Voice | null> {
    return this.prisma.voice.findUnique({
      where: { id },
    });
  }

  // ==================== Transaction Support ====================

  async executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  // ==================== Raw Query Operations ====================

  async getRandomStoryIds(limit: number, offset = 0): Promise<string[]> {
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Story"
      WHERE "isDeleted" = false
      ORDER BY RANDOM()
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return result.map((r) => r.id);
  }
}
