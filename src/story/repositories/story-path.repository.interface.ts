import { StoryPath, Kid, Story } from '@prisma/client';

export interface IStoryPathRepository {
  createStoryPath(kidId: string, storyId: string): Promise<StoryPath>;

  updateStoryPath(
    id: string,
    data: Partial<{ path: string; completedAt: Date | null | undefined }>,
  ): Promise<StoryPath>;

  findStoryPathById(id: string): Promise<StoryPath | null>;

  findStoryPathsByKidId(kidId: string): Promise<StoryPath[]>;

  // Helper lookups
  findKidById(id: string): Promise<Kid | null>;
  findStoryById(id: string): Promise<Story | null>;
}

export const STORY_PATH_REPOSITORY = Symbol('STORY_PATH_REPOSITORY');
