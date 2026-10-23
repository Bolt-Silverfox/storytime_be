import type { Prisma } from '@prisma/client';

export interface StoryReaderStats {
  storyId: string;
  distinctReaders: number;
  completedCount: number;
  avgTimeSpentSeconds: number;
}

export interface StoryReaderTrendPoint {
  date: string; // "YYYY-MM-DD"
  distinctReaders: number;
  completions: number;
}

export interface StoryReader {
  readerId: string;
  readerType: 'kid' | 'user';
  displayName: string;
  lastAccessed: Date;
}

export interface IAdminEngagementRepository {
  countKids(where: Prisma.KidWhereInput): Promise<number>;
  countStoryProgress(where?: Prisma.StoryProgressWhereInput): Promise<number>;
  countFavorites(where?: Prisma.FavoriteWhereInput): Promise<number>;
  // Average session duration (seconds) over sessions active in [start, end].
  // Uses lastActivityAt - createdAt; sessions without lastActivityAt excluded.
  getAverageSessionSeconds(start: Date, end: Date): Promise<number>;
  getStoryReaderStats(range: {
    start: Date;
    end: Date;
  }): Promise<StoryReaderStats[]>;
  getStoryReaderStatsForStory(
    storyId: string,
  ): Promise<StoryReaderStats | null>;
  getStoryReaderTrend(
    storyId: string,
    range: { start: Date; end: Date },
  ): Promise<StoryReaderTrendPoint[]>;
  getStoryReaders(storyId: string): Promise<StoryReader[]>;
}

export const ADMIN_ENGAGEMENT_REPOSITORY = Symbol(
  'ADMIN_ENGAGEMENT_REPOSITORY',
);
