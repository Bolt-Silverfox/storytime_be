import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type {
  IAdminEngagementRepository,
  StoryReaderStats,
  StoryReaderTrendPoint,
  StoryReader,
} from './admin-engagement.repository.interface';

@Injectable()
export class PrismaAdminEngagementRepository implements IAdminEngagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  countKids(where: Prisma.KidWhereInput): Promise<number> {
    return this.prisma.kid.count({ where });
  }

  countStoryProgress(where?: Prisma.StoryProgressWhereInput): Promise<number> {
    return this.prisma.storyProgress.count({ where });
  }

  countFavorites(where?: Prisma.FavoriteWhereInput): Promise<number> {
    return this.prisma.favorite.count({ where });
  }

  async getAverageSessionSeconds(start: Date, end: Date): Promise<number> {
    const rows = await this.prisma.session.findMany({
      where: {
        isDeleted: false,
        lastActivityAt: { not: null, gte: start, lte: end },
      },
      select: { createdAt: true, lastActivityAt: true },
    });
    if (rows.length === 0) return 0;
    const totalSeconds = rows.reduce((sum, r) => {
      const lastActivity = r.lastActivityAt as Date;
      return sum + (lastActivity.getTime() - r.createdAt.getTime()) / 1000;
    }, 0);
    return totalSeconds / rows.length;
  }

  async getStoryReaderStats(range: {
    start: Date;
    end: Date;
  }): Promise<StoryReaderStats[]> {
    const rows = await this.prisma.$queryRaw<
      {
        story_id: string;
        kid_readers: bigint;
        user_readers: bigint;
        completed_count: bigint;
        avg_time_spent_seconds: string | number | null;
      }[]
    >(Prisma.sql`
      SELECT
        combined."storyId" AS story_id,
        COUNT(DISTINCT combined."kidReader") AS kid_readers,
        COUNT(DISTINCT combined."userReader") AS user_readers,
        SUM(CASE WHEN combined.completed THEN 1 ELSE 0 END) AS completed_count,
        AVG(combined."totalTimeSpent") AS avg_time_spent_seconds
      FROM (
        SELECT sp."storyId", sp."kidId" AS "kidReader", NULL::text AS "userReader", sp.completed, sp."totalTimeSpent"
        FROM story_progress sp
        JOIN kids k ON k.id = sp."kidId"
        JOIN stories s ON s.id = sp."storyId"
        WHERE sp."isDeleted" = false AND k."isDeleted" = false AND s."isDeleted" = false
          AND sp."lastAccessed" BETWEEN ${range.start} AND ${range.end}
        UNION ALL
        SELECT usp."storyId", NULL::text AS "kidReader", usp."userId" AS "userReader", usp.completed, usp."totalTimeSpent"
        FROM user_story_progress usp
        JOIN users u ON u.id = usp."userId"
        JOIN stories s ON s.id = usp."storyId"
        WHERE usp."isDeleted" = false AND u."isDeleted" = false AND s."isDeleted" = false
          AND usp."lastAccessed" BETWEEN ${range.start} AND ${range.end}
      ) combined
      GROUP BY combined."storyId"
    `);

    return rows.map((r) => ({
      storyId: r.story_id,
      distinctReaders: Number(r.kid_readers) + Number(r.user_readers),
      completedCount: Number(r.completed_count),
      avgTimeSpentSeconds: Number(r.avg_time_spent_seconds ?? 0),
    }));
  }

  async getStoryReaderStatsForStory(
    storyId: string,
  ): Promise<StoryReaderStats | null> {
    const rows = await this.prisma.$queryRaw<
      {
        kid_readers: bigint;
        user_readers: bigint;
        completed_count: bigint;
        avg_time_spent_seconds: string | number | null;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(DISTINCT combined."kidReader") AS kid_readers,
        COUNT(DISTINCT combined."userReader") AS user_readers,
        SUM(CASE WHEN combined.completed THEN 1 ELSE 0 END) AS completed_count,
        AVG(combined."totalTimeSpent") AS avg_time_spent_seconds
      FROM (
        SELECT sp."kidId" AS "kidReader", NULL::text AS "userReader", sp.completed, sp."totalTimeSpent"
        FROM story_progress sp
        JOIN kids k ON k.id = sp."kidId"
        JOIN stories s ON s.id = sp."storyId"
        WHERE sp."isDeleted" = false AND k."isDeleted" = false AND s."isDeleted" = false
          AND sp."storyId" = ${storyId}
        UNION ALL
        SELECT NULL::text AS "kidReader", usp."userId" AS "userReader", usp.completed, usp."totalTimeSpent"
        FROM user_story_progress usp
        JOIN users u ON u.id = usp."userId"
        JOIN stories s ON s.id = usp."storyId"
        WHERE usp."isDeleted" = false AND u."isDeleted" = false AND s."isDeleted" = false
          AND usp."storyId" = ${storyId}
      ) combined
    `);

    const r = rows[0];
    if (!r || (Number(r.kid_readers) === 0 && Number(r.user_readers) === 0)) {
      return null;
    }
    return {
      storyId,
      distinctReaders: Number(r.kid_readers) + Number(r.user_readers),
      completedCount: Number(r.completed_count),
      avgTimeSpentSeconds: Number(r.avg_time_spent_seconds ?? 0),
    };
  }

  async getStoryReaderTrend(
    storyId: string,
    range: { start: Date; end: Date },
  ): Promise<StoryReaderTrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      {
        day: Date;
        kid_readers: bigint;
        user_readers: bigint;
        completions: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        DATE_TRUNC('day', combined."lastAccessed")::date AS day,
        COUNT(DISTINCT combined."kidReader") AS kid_readers,
        COUNT(DISTINCT combined."userReader") AS user_readers,
        SUM(CASE WHEN combined.completed THEN 1 ELSE 0 END) AS completions
      FROM (
        SELECT sp."kidId" AS "kidReader", NULL::text AS "userReader", sp.completed, sp."lastAccessed"
        FROM story_progress sp
        JOIN kids k ON k.id = sp."kidId"
        JOIN stories s ON s.id = sp."storyId"
        WHERE sp."isDeleted" = false AND k."isDeleted" = false AND s."isDeleted" = false
          AND sp."storyId" = ${storyId}
          AND sp."lastAccessed" BETWEEN ${range.start} AND ${range.end}
        UNION ALL
        SELECT NULL::text AS "kidReader", usp."userId" AS "userReader", usp.completed, usp."lastAccessed"
        FROM user_story_progress usp
        JOIN users u ON u.id = usp."userId"
        JOIN stories s ON s.id = usp."storyId"
        WHERE usp."isDeleted" = false AND u."isDeleted" = false AND s."isDeleted" = false
          AND usp."storyId" = ${storyId}
          AND usp."lastAccessed" BETWEEN ${range.start} AND ${range.end}
      ) combined
      GROUP BY day
      ORDER BY day ASC
    `);

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      distinctReaders: Number(r.kid_readers) + Number(r.user_readers),
      completions: Number(r.completions),
    }));
  }

  async getStoryReaders(storyId: string): Promise<StoryReader[]> {
    const rows = await this.prisma.$queryRaw<
      {
        reader_id: string;
        reader_type: 'kid' | 'user';
        display_name: string | null;
        last_accessed: Date;
      }[]
    >(Prisma.sql`
      SELECT sp."kidId" AS reader_id, 'kid' AS reader_type, k.name AS display_name, sp."lastAccessed" AS last_accessed
      FROM story_progress sp
      JOIN kids k ON k.id = sp."kidId"
      WHERE sp."storyId" = ${storyId} AND sp."isDeleted" = false AND k."isDeleted" = false
      UNION ALL
      SELECT usp."userId" AS reader_id, 'user' AS reader_type, u.name AS display_name, usp."lastAccessed" AS last_accessed
      FROM user_story_progress usp
      JOIN users u ON u.id = usp."userId"
      WHERE usp."storyId" = ${storyId} AND usp."isDeleted" = false AND u."isDeleted" = false
      ORDER BY last_accessed DESC
    `);

    return rows.map((r) => ({
      readerId: r.reader_id,
      readerType: r.reader_type,
      displayName: r.display_name ?? 'Unnamed',
      lastAccessed: r.last_accessed,
    }));
  }
}
