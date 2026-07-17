import {
  StoryProgress,
  UserStoryProgress,
  Story,
  Category,
  Kid,
  User,
  Prisma,
} from '@prisma/client';

export type StoryProgressWithStory = StoryProgress & {
  story: Story & { categories: Category[] };
};

export type UserStoryProgressWithStory = UserStoryProgress & {
  story: Story & { categories: Category[] };
};

export interface ProgressPageOptions {
  take?: number;
  cursor?: string;
}

export interface IStoryProgressRepository {
  // Entity lookups
  findKidById(id: string): Promise<Kid | null>;
  findStoryById(id: string): Promise<Story | null>;
  findUserById(id: string): Promise<User | null>;
  updateKidReadingLevel(kidId: string, newLevel: number): Promise<Kid>;

  // Kid Progress
  findStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<StoryProgress | null>;

  upsertKidProgress(
    kidId: string,
    storyId: string,
    data: { progress: number; completed: boolean; sessionTime: number },
  ): Promise<StoryProgress>;

  findContinueReadingProgress(
    kidId: string,
    opts?: ProgressPageOptions,
  ): Promise<StoryProgressWithStory[]>;

  findCompletedProgress(
    kidId: string,
    opts?: ProgressPageOptions,
  ): Promise<StoryProgressWithStory[]>;

  // User (Adult) Progress
  findUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress | null>;

  findActiveUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress | null>;

  upsertUserProgress(
    userId: string,
    storyId: string,
    data: {
      progress: number;
      completed: boolean;
      createTotalTimeSpent: number;
      updateTotalTimeSpent: number | Prisma.IntFieldUpdateOperationsInput;
    },
  ): Promise<UserStoryProgress>;

  findUserContinueReadingProgress(
    userId: string,
    opts?: ProgressPageOptions,
  ): Promise<UserStoryProgressWithStory[]>;

  findUserCompletedProgress(
    userId: string,
    opts?: ProgressPageOptions,
  ): Promise<UserStoryProgressWithStory[]>;

  removeFromUserLibrary(
    userId: string,
    storyId: string,
  ): Promise<[Prisma.BatchPayload, Prisma.BatchPayload]>;
}

export const STORY_PROGRESS_REPOSITORY = Symbol('STORY_PROGRESS_REPOSITORY');
