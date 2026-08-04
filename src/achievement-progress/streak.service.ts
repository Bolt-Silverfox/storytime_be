import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  StreakResponseDto,
  WeeklyActivityDto,
} from './dto/streak-response.dto';

@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(private prisma: PrismaService) {}

  // Get streak summary for a user

  async getStreakSummary(userId: string): Promise<StreakResponseDto> {
    try {
      // Get last 30 days of activity logs to calculate streak
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Query activity logs where user was active
      const activities = await this.prisma.activityLog.findMany({
        where: {
          userId,
          createdAt: { gte: thirtyDaysAgo },
          action: {
            in: ['story_read', 'challenge_completed', 'quiz_answered'],
          },
        },
        select: {
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get unique dates (YYYY-MM-DD format)
      const activeDates = new Set(
        activities.map((a) => a.createdAt.toISOString().split('T')[0]),
      );

      // Calculate current streak
      let currentStreak = 0;
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Check if user was active today or yesterday to start streak
      if (activeDates.has(today) || activeDates.has(yesterdayStr)) {
        const checkDate = new Date();
        if (!activeDates.has(today)) {
          checkDate.setDate(checkDate.getDate() - 1); // Start from yesterday if not active today
        }

        while (true) {
          const dateStr = checkDate.toISOString().split('T')[0];
          if (activeDates.has(dateStr)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
      }

      // Build weekly activity (last 7 days including today)
      const weeklyActivity: WeeklyActivityDto[] = [];
      const now = new Date();
      const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const dayName = dayNames[date.getDay()];
        const dateStr = date.toISOString().split('T')[0];
        const isActive = activeDates.has(dateStr);

        weeklyActivity.push({
          day: dayName,
          date: date.toISOString(),
          isActive,
        });
      }

      // Get last active date
      const lastActivity = await this.prisma.activityLog.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      return {
        currentStreak,
        weeklyActivity,
        lastActiveDate: lastActivity?.createdAt?.toISOString() || null,
      };
    } catch (error) {
      this.logger.error(`Error calculating streak for user ${userId}:`, error);
      // Return default values on error
      return {
        currentStreak: 0,
        weeklyActivity: this.getDefaultWeeklyActivity(),
        lastActiveDate: null,
      };
    }
  }

  // Get streak summary for a specific kid
  async getStreakSummaryForKid(kidId: string): Promise<StreakResponseDto> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Query activity logs where kid was active
      const activities = await this.prisma.activityLog.findMany({
        where: {
          kidId,
          createdAt: { gte: thirtyDaysAgo },
          action: {
            in: ['story_read', 'challenge_completed', 'quiz_answered'],
          },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      const activeDates = new Set(
        activities.map((a) => a.createdAt.toISOString().split('T')[0]),
      );

      let currentStreak = 0;
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (activeDates.has(today) || activeDates.has(yesterdayStr)) {
        const checkDate = new Date();
        if (!activeDates.has(today)) {
          checkDate.setDate(checkDate.getDate() - 1);
        }

        while (true) {
          const dateStr = checkDate.toISOString().split('T')[0];
          if (activeDates.has(dateStr)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
      }

      const weeklyActivity: WeeklyActivityDto[] = [];
      const now = new Date();
      const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        const dayName = dayNames[date.getDay()];
        const dateStr = date.toISOString().split('T')[0];
        const isActive = activeDates.has(dateStr);
        weeklyActivity.push({
          day: dayName,
          date: date.toISOString(),
          isActive,
        });
      }

      const lastActivity = await this.prisma.activityLog.findFirst({
        where: { kidId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      return {
        currentStreak,
        weeklyActivity,
        lastActiveDate: lastActivity?.createdAt?.toISOString() || null,
      };
    } catch (error) {
      this.logger.error(`Error calculating streak for kid ${kidId}:`, error);
      return {
        currentStreak: 0,
        weeklyActivity: this.getDefaultWeeklyActivity(),
        lastActiveDate: null,
      };
    }
  }

  private getDefaultWeeklyActivity(): WeeklyActivityDto[] {
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (6 - i));
      return {
        day: dayNames[date.getDay()],
        date: date.toISOString(),
        isActive: false,
      };
    });
  }
}
