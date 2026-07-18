import type { Prisma } from '@prisma/client';

export interface IAdminEngagementRepository {
  countKids(where: Prisma.KidWhereInput): Promise<number>;
  countStoryProgress(where?: Prisma.StoryProgressWhereInput): Promise<number>;
  countFavorites(where?: Prisma.FavoriteWhereInput): Promise<number>;
}

export const ADMIN_ENGAGEMENT_REPOSITORY = Symbol(
  'ADMIN_ENGAGEMENT_REPOSITORY',
);
