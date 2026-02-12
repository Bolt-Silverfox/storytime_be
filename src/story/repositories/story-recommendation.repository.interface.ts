import { ParentRecommendation } from '@prisma/client';
import { ParentRecommendationWithRelations } from './story.repository.interface';

export interface IStoryRecommendationRepository {
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
  ): Promise<Array<{ storyId: string; _count: { storyId: number } }>>;
}

export const STORY_RECOMMENDATION_REPOSITORY = Symbol(
  'STORY_RECOMMENDATION_REPOSITORY',
);
