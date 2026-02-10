import { Injectable, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { StreakService } from './streak.service';
import { BadgeService } from './badge.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressHomeResponseDto } from './dto/progress-response.dto';
import { ProgressOverviewResponseDto } from './dto/progress-response.dto';
import { ProgressStatsDto } from './dto/progress-response.dto';
import { CACHE_KEYS, CACHE_TTL_MS } from '@/shared/constants/cache-keys.constants';

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private streakService: StreakService,
    private badgeService: BadgeService,
    private prisma: PrismaService,
  ) {}

  // Get aggregated home screen data

  async getHomeScreenData(userId: string): Promise<ProgressHomeResponseDto> {
    const cacheKey = CACHE_KEYS.PROGRESS_HOME(userId);

    // Try cache first
    const cached =
      await this.cacheManager.get<ProgressHomeResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const [streak, badgesPreview, progressStats] = await Promise.all([
        this.streakService.getStreakSummary(userId),
        this.badgeService.getBadgePreview(userId),
        this.getProgressStats(userId),
      ]);

      const result: ProgressHomeResponseDto = {
        streak,
        badgesPreview,
        progressStats,
      };

      // Cache for 5 minutes
      await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.USER_DATA);

      return result;
    } catch (error) {
      this.logger.error(`Error getting home screen data:`, error);
      throw error;
    }
  }

  // Get progress overview (lightweight)

  async getOverview(userId: string): Promise<ProgressOverviewResponseDto> {
    const cacheKey = CACHE_KEYS.PROGRESS_OVERVIEW(userId);

    const cached =
      await this.cacheManager.get<ProgressOverviewResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const [streak, badgesPreview, stats] = await Promise.all([
        this.streakService.getStreakSummary(userId),
        this.badgeService.getBadgePreview(userId),
        this.getProgressStats(userId),
      ]);

      const result: ProgressOverviewResponseDto = {
        streak,
        badgesPreview,
        storiesCompleted: stats.storiesCompleted,
        challengesCompleted: stats.challengesCompleted,
      };

      await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.USER_DATA);

      return result;
    } catch (error) {
      this.logger.error(`Error getting progress overview:`, error);
      throw error;
    }
  }

  // Calculate progress stats for a user

  private async getProgressStats(userId: string): Promise<ProgressStatsDto> {
    try {
      // Get user's kids
      const kids = await this.prisma.kid.findMany({
        where: { parentId: userId },
        select: { id: true },
      });

      const kidIds = kids.map((k) => k.id);

      // Stories completed (from StoryProgress)
      const storiesCompleted = await this.prisma.storyProgress.count({
        where: {
          kidId: { in: kidIds },
          completed: true,
        },
      });

      // Challenges completed
      const challengesCompleted =
        await this.prisma.dailyChallengeAssignment.count({
          where: {
            kidId: { in: kidIds },
            completed: true,
          },
        });

      // Total reading time from screen time sessions
      const sessions = await this.prisma.screenTimeSession.aggregate({
        where: {
          kidId: { in: kidIds },
          endTime: { not: null },
        },
        _sum: {
          duration: true,
        },
      });

      const totalReadingTimeMins = Math.floor(
        (sessions._sum.duration || 0) / 60,
      );

      return {
        storiesCompleted,
        challengesCompleted,
        totalReadingTimeMins,
      };
    } catch (error) {
      this.logger.error(`Error calculating progress stats:`, error);
      return {
        storiesCompleted: 0,
        challengesCompleted: 0,
        totalReadingTimeMins: 0,
      };
    }
  }

  // Invalidate user cache (call when progress changes)

  async invalidateCache(userId: string): Promise<void> {
    await this.cacheManager.del(`progress:home:${userId}`);
    await this.cacheManager.del(`progress:overview:${userId}`);
    this.logger.log(`Invalidated progress cache for user ${userId}`);
  }
}
