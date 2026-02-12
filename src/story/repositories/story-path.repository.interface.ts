import { StoryPath } from '@prisma/client';

export interface IStoryPathRepository {
    createStoryPath(kidId: string, storyId: string): Promise<StoryPath>;

    updateStoryPath(
        id: string,
        data: Partial<{ path: string; completedAt: Date | null }>,
    ): Promise<StoryPath>;

    findStoryPathById(id: string): Promise<StoryPath | null>;

    findStoryPathsByKidId(kidId: string): Promise<StoryPath[]>;
}

export const STORY_PATH_REPOSITORY = Symbol('STORY_PATH_REPOSITORY');
