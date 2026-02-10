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

// ==================== Type Aliases ====================

export type StoryWithRelations = Story & {
  images?: StoryImage[];
  branches?: StoryBranch[];
  categories?: Category[];
  themes?: Theme[];
  seasons?: Season[];
  questions?: Array<{ id: string }>;
};

export type StoryWithImages = Story & { images: StoryImage[] };

export type KidWithPreferences = Kid & {
  preferredCategories: Category[];
  parentRecommendations?: { storyId: string }[];
  restrictedStories?: { storyId: string }[];
  preferredVoice?: Voice | null;
};

export type UserWithPreferences = User & {
  preferredCategories: Category[];
};

export type DailyChallengeWithStory = DailyChallenge & {
  story: Story;
};

export type DailyChallengeAssignmentWithChallenge = DailyChallengeAssignment & {
  challenge: DailyChallengeWithStory;
};

export type StoryProgressWithStory = StoryProgress & {
  story: Story;
};

export type UserStoryProgressWithStory = UserStoryProgress & {
  story: Story;
};

export type DownloadedStoryWithStory = DownloadedStory & {
  story: Story;
};

export type RestrictedStoryWithStory = RestrictedStory & {
  story: Story;
};

export type ParentRecommendationWithRelations = ParentRecommendation & {
  story?: Story;
  user?: { id: string; name?: string | null; email?: string };
  kid?: { id: string; name?: string | null };
};

export type FavoriteWithStory = Favorite & {
  story: Story;
};

export type CategoryWithCount = Category & {
  _count: { stories: number };
};

// ==================== Interface Definition ====================

export interface IStoryRepository {
  // ==================== Story CRUD Operations ====================

  findStoryById(id: string, includeDeleted?: boolean): Promise<Story | null>;

  findStoryByIdWithRelations(
    id: string,
    includeDeleted?: boolean,
  ): Promise<StoryWithRelations | null>;

  findStories(params: {
    where: Prisma.StoryWhereInput;
    skip?: number;
    take?: number;
    orderBy?:
      | Prisma.StoryOrderByWithRelationInput
      | Prisma.StoryOrderByWithRelationInput[];
    include?: Prisma.StoryInclude;
  }): Promise<StoryWithRelations[]>;

  countStories(where: Prisma.StoryWhereInput): Promise<number>;

  createStory(
    data: Prisma.StoryCreateInput,
    include?: Prisma.StoryInclude,
  ): Promise<StoryWithRelations>;

  updateStory(
    id: string,
    data: Prisma.StoryUpdateInput,
    include?: Prisma.StoryInclude,
  ): Promise<StoryWithRelations>;

  deleteStoryPermanently(id: string): Promise<Story>;

  softDeleteStory(id: string): Promise<Story>;

  restoreStory(id: string): Promise<Story>;

  // ==================== Story Image/Branch Operations ====================

  createStoryImage(data: Prisma.StoryImageCreateInput): Promise<StoryImage>;

  createStoryBranch(data: Prisma.StoryBranchCreateInput): Promise<StoryBranch>;

  // ==================== Favorite Operations (Kid) ====================

  createFavorite(kidId: string, storyId: string): Promise<Favorite>;

  deleteFavorites(kidId: string, storyId: string): Promise<{ count: number }>;

  findFavoritesByKidId(kidId: string): Promise<FavoriteWithStory[]>;

  // ==================== Parent Favorite Operations ====================

  deleteParentFavorites(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }>;

  // ==================== Story Progress Operations (Kid) ====================

  findStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<StoryProgress | null>;

  upsertStoryProgress(
    kidId: string,
    storyId: string,
    data: {
      progress: number;
      completed: boolean;
      totalTimeSpent?: number;
    },
  ): Promise<StoryProgress>;

  findContinueReadingProgress(kidId: string): Promise<StoryProgressWithStory[]>;

  findCompletedProgress(kidId: string): Promise<StoryProgressWithStory[]>;

  deleteStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }>;

  // ==================== User Story Progress Operations ====================

  findUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress | null>;

  upsertUserStoryProgress(
    userId: string,
    storyId: string,
    data: {
      progress: number;
      completed: boolean;
      totalTimeSpent?: number;
    },
  ): Promise<UserStoryProgress>;

  findUserContinueReadingProgress(
    userId: string,
  ): Promise<UserStoryProgressWithStory[]>;

  findUserCompletedProgress(
    userId: string,
  ): Promise<UserStoryProgressWithStory[]>;

  deleteUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }>;

  createUserStoryProgressRecord(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress>;

  // ==================== Daily Challenge Operations ====================

  createDailyChallenge(
    data: Prisma.DailyChallengeCreateInput,
  ): Promise<DailyChallenge>;

  createManyDailyChallenges(
    data: Prisma.DailyChallengeCreateManyInput[],
  ): Promise<{ count: number }>;

  findDailyChallengesByDate(date: Date): Promise<DailyChallengeWithStory[]>;

  findDailyChallengeByStoryAndDate(
    storyId: string,
    date: Date,
  ): Promise<DailyChallenge | null>;

  // ==================== Daily Challenge Assignment Operations ====================

  createDailyChallengeAssignment(
    kidId: string,
    challengeId: string,
  ): Promise<DailyChallengeAssignment>;

  createManyDailyChallengeAssignments(
    data: { kidId: string; challengeId: string }[],
  ): Promise<{ count: number }>;

  updateDailyChallengeAssignment(
    id: string,
    data: Partial<{ completed: boolean; completedAt: Date }>,
  ): Promise<DailyChallengeAssignment>;

  findDailyChallengeAssignmentById(
    id: string,
  ): Promise<DailyChallengeAssignment | null>;

  findDailyChallengeAssignmentsForKid(
    kidId: string,
  ): Promise<DailyChallengeAssignment[]>;

  findTodaysDailyChallengeAssignment(
    kidId: string,
    today: Date,
    tomorrow: Date,
  ): Promise<DailyChallengeAssignmentWithChallenge | null>;

  findWeeklyDailyChallengeAssignments(
    kidId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<DailyChallengeAssignmentWithChallenge[]>;

  findAllDailyChallengeAssignments(): Promise<
    (DailyChallengeAssignment & { challenge: DailyChallenge })[]
  >;

  // ==================== Story Path Operations ====================

  createStoryPath(kidId: string, storyId: string): Promise<StoryPath>;

  updateStoryPath(
    id: string,
    data: Partial<{ path: string; completedAt: Date | null }>,
  ): Promise<StoryPath>;

  findStoryPathById(id: string): Promise<StoryPath | null>;

  findStoryPathsByKidId(kidId: string): Promise<StoryPath[]>;

  // ==================== Category/Theme/Season Operations ====================

  findAllCategories(): Promise<CategoryWithCount[]>;

  findCategoriesByIds(ids: string[]): Promise<Category[]>;

  findAllThemes(): Promise<Theme[]>;

  findThemesByIds(ids: string[]): Promise<Theme[]>;

  findAllSeasons(): Promise<Season[]>;

  findSeasonsByIds(ids: string[]): Promise<Season[]>;

  // ==================== Download Operations ====================

  findDownloadsByKidId(kidId: string): Promise<DownloadedStoryWithStory[]>;

  upsertDownload(kidId: string, storyId: string): Promise<DownloadedStory>;

  deleteDownload(
    kidId: string,
    storyId: string,
  ): Promise<DownloadedStory | null>;

  deleteDownloads(kidId: string, storyId: string): Promise<{ count: number }>;

  // ==================== Restriction Operations ====================

  upsertRestrictedStory(
    kidId: string,
    storyId: string,
    userId: string,
    reason?: string,
  ): Promise<RestrictedStory>;

  findRestrictedStory(
    kidId: string,
    storyId: string,
  ): Promise<RestrictedStory | null>;

  deleteRestrictedStory(
    kidId: string,
    storyId: string,
  ): Promise<RestrictedStory>;

  findRestrictedStoriesByKidId(
    kidId: string,
  ): Promise<RestrictedStoryWithStory[]>;

  // ==================== Parent Recommendation Operations ====================

  findParentRecommendation(
    userId: string,
    kidId: string,
    storyId: string,
  ): Promise<ParentRecommendation | null>;

  findParentRecommendationById(
    id: string,
  ): Promise<ParentRecommendation | null>;

  createParentRecommendation(
    userId: string,
    kidId: string,
    storyId: string,
    message?: string,
  ): Promise<ParentRecommendationWithRelations>;

  updateParentRecommendation(
    id: string,
    data: Partial<{
      isDeleted: boolean;
      deletedAt: Date | null;
      message: string | null;
    }>,
  ): Promise<ParentRecommendationWithRelations>;

  deleteParentRecommendation(id: string): Promise<ParentRecommendation>;

  findParentRecommendationsByKidId(
    kidId: string,
  ): Promise<ParentRecommendationWithRelations[]>;

  countParentRecommendationsByKidId(kidId: string): Promise<number>;

  groupParentRecommendationsByStory(
    limit: number,
  ): Promise<{ storyId: string; _count: { storyId: number } }[]>;

  // ==================== Audio Cache Operations ====================

  findStoryAudioCache(
    storyId: string,
    voiceType: string,
  ): Promise<StoryAudioCache | null>;

  createStoryAudioCache(
    storyId: string,
    voiceType: string,
    audioUrl: string,
  ): Promise<StoryAudioCache>;

  // ==================== Usage Tracking Operations ====================

  findUserUsage(userId: string): Promise<UserUsage | null>;

  createUserUsage(data: Prisma.UserUsageCreateInput): Promise<UserUsage>;

  updateUserUsage(
    userId: string,
    data: Prisma.UserUsageUpdateInput,
  ): Promise<UserUsage>;

  upsertUserUsage(
    userId: string,
    createData: Omit<Prisma.UserUsageCreateInput, 'user'>,
    updateData: Prisma.UserUsageUpdateInput,
  ): Promise<UserUsage>;

  // ==================== Kid Operations ====================

  findKidById(id: string, includeDeleted?: boolean): Promise<Kid | null>;

  findKidByIdAndParent(kidId: string, parentId: string): Promise<Kid | null>;

  findKidByIdWithPreferences(id: string): Promise<KidWithPreferences | null>;

  findAllKids(): Promise<Kid[]>;

  updateKidReadingLevel(kidId: string, newLevel: number): Promise<Kid>;

  // ==================== User Operations ====================

  findUserById(id: string, includeDeleted?: boolean): Promise<User | null>;

  findUserByIdWithPreferences(id: string): Promise<UserWithPreferences | null>;

  // ==================== Voice Operations ====================

  findVoiceById(id: string): Promise<Voice | null>;

  // ==================== Transaction Support ====================

  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;

  // ==================== Raw Query Operations ====================

  getRandomStoryIds(limit: number, offset?: number): Promise<string[]>;
}

// Injection token
export const STORY_REPOSITORY = Symbol('STORY_REPOSITORY');
