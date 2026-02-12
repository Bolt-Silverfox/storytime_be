import { Favorite, Story, Kid } from '@prisma/client';

export type FavoriteWithStory = Favorite & {
    story: Story;
};

export interface IStoryFavoriteRepository {
    createFavorite(kidId: string, storyId: string): Promise<Favorite>;

    deleteFavorites(
        kidId: string,
        storyId: string,
    ): Promise<{ count: number }>;

    findFavoritesByKidId(kidId: string): Promise<FavoriteWithStory[]>;

    // Helper lookups
    findKidById(id: string): Promise<Kid | null>;
    findStoryById(id: string): Promise<Story | null>;
}

export const STORY_FAVORITE_REPOSITORY = Symbol('STORY_FAVORITE_REPOSITORY');
