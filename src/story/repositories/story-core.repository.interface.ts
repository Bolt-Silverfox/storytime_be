import { Prisma, Story, RestrictedStory, Kid } from '@prisma/client';
import { StoryWithRelations, UserWithPreferences } from './story.repository.interface';

export type RestrictedStoryWithStory = RestrictedStory & { story: Story };

export interface IStoryCoreRepository {
    // ... (existing methods) ...
    findRestrictedStories(kidId: string): Promise<RestrictedStoryWithStory[]>;
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

    // Restrictions
    restrictStory(
        kidId: string,
        storyId: string,
        userId: string,
        reason?: string,
    ): Promise<RestrictedStory>;

    unrestrictStory(kidId: string, storyId: string): Promise<RestrictedStory>;

    findRestrictedStories(kidId: string): Promise<RestrictedStory[]>;

    findRestrictedStory(kidId: string, storyId: string): Promise<RestrictedStory | null>;

    // User/Kid Lookups
    findUserByIdWithPreferences(userId: string): Promise<UserWithPreferences | null>;

    findKidById(kidId: string): Promise<Kid | null>;

    findKidByIdAndParent(kidId: string, userId: string): Promise<Kid | null>;

    // Utilities
    getRandomStoryIds(limit: number, offset?: number): Promise<string[]>;
}

export const STORY_CORE_REPOSITORY = Symbol('STORY_CORE_REPOSITORY');
