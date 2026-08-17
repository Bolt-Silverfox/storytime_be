import type { Prisma } from '@prisma/client';

export interface IAdminEngagementRepository {
  countKids(where: Prisma.KidWhereInput): Promise<number>;
  countStoryProgress(where?: Prisma.StoryProgressWhereInput): Promise<number>;
  countFavorites(where?: Prisma.FavoriteWhereInput): Promise<number>;
  // Average session duration (seconds) over sessions active in [start, end].
  // Uses lastActivityAt - createdAt; sessions without lastActivityAt excluded.
  getAverageSessionSeconds(start: Date, end: Date): Promise<number>;
}

export const ADMIN_ENGAGEMENT_REPOSITORY = Symbol(
  'ADMIN_ENGAGEMENT_REPOSITORY',
);
