import type { ParentFavorite, Story, Category } from '@prisma/client';

// ==================== Types ====================
export interface ParentFavoriteWithStory extends ParentFavorite {
  story: Story & {
    categories: Category[];
  };
}

// ==================== Repository Interface ====================
export interface IParentFavoriteRepository {
  // Create a parent favorite
  createParentFavorite(
    userId: string,
    storyId: string,
  ): Promise<ParentFavoriteWithStory>;

  // Find all favorites for a user
  findFavoritesByUserId(userId: string): Promise<ParentFavoriteWithStory[]>;

  // Find a specific favorite
  findFavorite(userId: string, storyId: string): Promise<ParentFavorite | null>;

  // Find favorites with cursor-based pagination
  findFavoritesPaginated(params: {
    userId: string;
    cursor?: { id: string };
    skip?: number;
    take: number;
  }): Promise<ParentFavoriteWithStory[]>;

  // Delete a favorite by id
  deleteParentFavorite(id: string): Promise<void>;
}

export const PARENT_FAVORITE_REPOSITORY = Symbol('PARENT_FAVORITE_REPOSITORY');
