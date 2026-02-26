import { StoryProgress, UserStoryProgress, Story } from '@prisma/client';

export type StoryProgressWithStory = StoryProgress & {
  story: Story;
};

export type UserStoryProgressWithStory = UserStoryProgress & {
  story: Story;
};

export interface IStoryProgressRepository {
  // Kid Progress
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

  findContinueReadingProgressPaginated(
    kidId: string,
    cursor?: { id: string },
    take?: number,
  ): Promise<StoryProgressWithStory[]>;

  findCompletedProgressPaginated(
    kidId: string,
    cursor?: { id: string },
    take?: number,
  ): Promise<StoryProgressWithStory[]>;

  deleteStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }>;

  // User (Adult) Progress
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

  findUserContinueReadingProgressPaginated(
    userId: string,
    cursor?: { id: string },
    take?: number,
  ): Promise<UserStoryProgressWithStory[]>;

  findUserCompletedProgressPaginated(
    userId: string,
    cursor?: { id: string },
    take?: number,
  ): Promise<UserStoryProgressWithStory[]>;

  deleteUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }>;
}

export const STORY_PROGRESS_REPOSITORY = Symbol('STORY_PROGRESS_REPOSITORY');
