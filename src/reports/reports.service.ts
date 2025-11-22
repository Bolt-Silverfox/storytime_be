import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  KidOverviewStatsDto,
  KidDetailedReportDto,
  WeeklyReportDto,
  DailyLimitDto,
} from './reports.dto';
// import { SetDailyLimitDto } from '@/control/control.dto';
import { QuestionAnswerDto } from '../story/story.dto'; // Import from story module

const prisma = new PrismaClient();

@Injectable()
export class ReportsService {
  /**
   * Start a screen time session for a kid
   */
  async startScreenTimeSession(kidId: string) {
    // Check if there's an active session
    const activeSession = await prisma.screenTimeSession.findFirst({
      where: {
        kidId,
        endTime: null,
      },
    });

    if (activeSession) {
      return { sessionId: activeSession.id };
    }

    const session = await prisma.screenTimeSession.create({
      data: {
        kidId,
        date: new Date(),
      },
    });

    return { sessionId: session.id };
  }

  /**
   * End a screen time session
   */
  async endScreenTimeSession(sessionId: string) {
    const session = await prisma.screenTimeSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.endTime) {
      throw new BadRequestException('Invalid or already ended session');
    }

    const endTime = new Date();
    const duration = Math.floor(
      (endTime.getTime() - session.startTime.getTime()) / 1000,
    );

    await prisma.screenTimeSession.update({
      where: { id: sessionId },
      data: {
        endTime,
        duration,
      },
    });

    return { sessionId, duration };
  }

  /**
   * Record a question answer
   */
  async recordAnswer(dto: QuestionAnswerDto) {
    const question = await prisma.storyQuestion.findUnique({
      where: { id: dto.questionId },
      select: {
        id: true,
        options: true,
        correctOption: true,
      },
    });

    if (!question) {
      throw new BadRequestException('Question not found');
    }

    if (
      dto.selectedOption < 0 ||
      dto.selectedOption >= question.options.length
    ) {
      throw new BadRequestException('Invalid selectedOption index');
    }

    const isCorrect = question.correctOption === dto.selectedOption;

    const answer = await prisma.questionAnswer.create({
      data: {
        kidId: dto.kidId,
        questionId: dto.questionId,
        storyId: dto.storyId,
        selectedOption: dto.selectedOption,
        isCorrect,
      },
      select: {
        id: true,
        isCorrect: true,
      },
    });

    return {
      answerId: answer.id,
      isCorrect,
    };
  }

  /**
   * Get today's screen time for a kid
   */
  private async getTodayScreenTime(kidId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = await prisma.screenTimeSession.findMany({
      where: {
        kidId,
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    // Calculate total minutes including active session
    let totalSeconds = 0;
    const now = new Date();

    for (const session of sessions) {
      if (session.endTime && session.duration) {
        totalSeconds += session.duration;
      } else if (!session.endTime) {
        // Active session
        totalSeconds += Math.floor(
          (now.getTime() - session.startTime.getTime()) / 1000,
        );
      }
    }

    return Math.floor(totalSeconds / 60);
  }

  /**
   * Get screen time for a date range
   */
  private async getScreenTimeForRange(
    kidId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const sessions = await prisma.screenTimeSession.findMany({
      where: {
        kidId,
        date: {
          gte: startDate,
          lt: endDate,
        },
        endTime: { not: null },
      },
    });

    const totalSeconds = sessions.reduce(
      (sum, s) => sum + (s.duration || 0),
      0,
    );
    return Math.floor(totalSeconds / 60);
  }

  //   /**
  //    * Set daily screen time limit for a kid
  //    */
  //   async setDailyLimit(dto: SetDailyLimitDto) {
  //     await prisma.kid.update({
  //       where: { id: dto.kidId },
  //       data: {
  //         dailyScreenTimeLimitMins: dto.limitMins,
  //       },
  //     });

  //     return { success: true };
  //   }

  /**
   * Get effective daily limit for a kid
   * Priority: Kid's specific limit > Parent's default > No limit
   */
  private async getEffectiveDailyLimit(kidId: string): Promise<number | null> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        parent: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!kid) {
      return null;
    }

    // Priority 1: Kid's specific limit
    if (
      kid.dailyScreenTimeLimitMins !== null &&
      kid.dailyScreenTimeLimitMins !== undefined
    ) {
      return kid.dailyScreenTimeLimitMins;
    }

    // Priority 2: Parent's default limit
    if (kid.parent.profile?.maxScreenTimeMins) {
      return kid.parent.profile.maxScreenTimeMins;
    }

    // Priority 3: No limit
    return null;
  }

  /**
   * Get daily limit status
   */
  async getDailyLimitStatus(kidId: string): Promise<DailyLimitDto> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    const todayScreenTimeMins = await this.getTodayScreenTime(kidId);
    const limitMins = await this.getEffectiveDailyLimit(kidId);

    let remainingMins: number | undefined;
    let limitReached = false;

    if (limitMins !== null && limitMins !== undefined) {
      remainingMins = Math.max(0, limitMins - todayScreenTimeMins);
      limitReached = todayScreenTimeMins >= limitMins;
    }

    return {
      kidId,
      dailyLimitMins: limitMins ?? undefined,
      todayScreenTimeMins,
      remainingMins,
      limitReached,
    };
  }

  /**
   * Get weekly overview for all kids of a parent
   */
  async getWeeklyOverview(parentId: string): Promise<WeeklyReportDto> {
    const kids = await prisma.kid.findMany({
      where: { parentId },
      include: {
        avatar: true,
      },
    });

    // Get start and end of current week (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Sunday
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const kidStats: KidOverviewStatsDto[] = await Promise.all(
      kids.map(async (kid, index) => {
        // Stories completed this week
        const storiesCompleted = await prisma.storyProgress.count({
          where: {
            kidId: kid.id,
            completed: true,
            lastAccessed: {
              gte: weekStart,
              lt: weekEnd,
            },
          },
        });

        // Screen time this week
        const screenTimeMins = await this.getScreenTimeForRange(
          kid.id,
          weekStart,
          weekEnd,
        );

        // Stars earned (assuming daily challenge completions)
        const starsEarned = await prisma.dailyChallengeAssignment.count({
          where: {
            kidId: kid.id,
            completed: true,
            completedAt: {
              gte: weekStart,
              lt: weekEnd,
            },
          },
        });

        // Badges earned (reward redemptions)
        const badgesEarned = await prisma.rewardRedemption.count({
          where: {
            kidId: kid.id,
            redeemedAt: {
              gte: weekStart,
              lt: weekEnd,
            },
          },
        });

        return {
          kidId: kid.id,
          kidName: kid.name || 'Unknown',
          avatarUrl: kid.avatar?.url,
          rank: index + 1,
          storiesCompleted,
          screenTimeMins,
          starsEarned,
          badgesEarned,
        };
      }),
    );

    // Sort by stories completed (descending) for ranking
    kidStats.sort((a, b) => b.storiesCompleted - a.storiesCompleted);
    kidStats.forEach((stat, idx) => {
      stat.rank = idx + 1;
    });

    const totalStoriesCompleted = kidStats.reduce(
      (sum, k) => sum + k.storiesCompleted,
      0,
    );
    const totalScreenTimeMins = kidStats.reduce(
      (sum, k) => sum + k.screenTimeMins,
      0,
    );

    return {
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      kids: kidStats,
      totalStoriesCompleted,
      totalScreenTimeMins,
    };
  }

  /**
   * Get detailed report for a specific kid
   */
  async getKidDetailedReport(kidId: string): Promise<KidDetailedReportDto> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        avatar: true,
        activityLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Get start of current week
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);

    // Screen time today
    const screenTimeMins = await this.getTodayScreenTime(kidId);
    const screenTimeLimitMins = await this.getEffectiveDailyLimit(kidId);
    const screenTimeRemainingMins =
      screenTimeLimitMins !== null
        ? Math.max(0, screenTimeLimitMins - screenTimeMins)
        : undefined;

    // Stories this week
    const storiesCompleted = await prisma.storyProgress.count({
      where: {
        kidId,
        completed: true,
        lastAccessed: { gte: weekStart },
      },
    });

    const storiesInProgress = await prisma.storyProgress.count({
      where: {
        kidId,
        completed: false,
      },
    });

    // Quiz performance this week
    const answers = await prisma.questionAnswer.findMany({
      where: {
        kidId,
        answeredAt: { gte: weekStart },
      },
    });

    const rightAnswers = answers.filter((a) => a.isCorrect).length;
    const totalAnswers = answers.length;
    const accuracyPercentage =
      totalAnswers > 0 ? Math.round((rightAnswers / totalAnswers) * 100) : 0;

    // Stars earned this week
    const starsEarned = await prisma.dailyChallengeAssignment.count({
      where: {
        kidId,
        completed: true,
        completedAt: { gte: weekStart },
      },
    });

    // Badges earned this week
    const badgesEarned = await prisma.rewardRedemption.count({
      where: {
        kidId,
        redeemedAt: { gte: weekStart },
      },
    });

    // Favorites count
    const favoritesCount = await prisma.favorite.count({
      where: { kidId },
    });

    // Last active
    const lastActiveAt = kid.activityLogs[0]?.createdAt;

    return {
      kidId: kid.id,
      kidName: kid.name || 'Unknown',
      avatarUrl: kid.avatar?.url,
      screenTimeMins,
      screenTimeLimitMins,
      screenTimeRemainingMins,
      storiesCompleted,
      storiesInProgress,
      rightAnswers,
      totalAnswers,
      accuracyPercentage,
      starsEarned,
      badgesEarned,
      favoritesCount,
      lastActiveAt,
    };
  }
}
