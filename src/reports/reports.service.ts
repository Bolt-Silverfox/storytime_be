import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  KidOverviewStatsDto,
  KidDetailedReportDto,
  WeeklyReportDto,
} from './dto/reports.dto';
import { QuestionAnswerDto } from '../story/dto/story.dto';
import { BadgeProgressEngine } from '../achievement-progress/badge-progress.engine';
import { ScreenTimeService } from './services/screen-time.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeProgressEngine: BadgeProgressEngine,
    private readonly screenTimeService: ScreenTimeService,
  ) {}

  /**
   * Record a question answer
   */
  async recordAnswer(dto: QuestionAnswerDto) {
    const question = await this.prisma.storyQuestion.findUnique({
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

    const answer = await this.prisma.questionAnswer.create({
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

    // Trigger badge progress for quiz answered
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId },
      select: { parentId: true },
    });

    if (kid?.parentId) {
      await this.badgeProgressEngine.recordActivity(
        kid.parentId,
        'quiz_answered',
        dto.kidId,
        { questionId: dto.questionId, isCorrect },
      );
    }

    return {
      answerId: answer.id,
      isCorrect,
    };
  }

  /**
   * Get weekly overview for all kids of a parent
   */
  async getWeeklyOverview(parentId: string): Promise<WeeklyReportDto> {
    const kids = await this.prisma.kid.findMany({
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
        const storiesCompleted = await this.prisma.storyProgress.count({
          where: {
            kidId: kid.id,
            completed: true,
            lastAccessed: {
              gte: weekStart,
              lt: weekEnd,
            },
          },
        });

        // Screen time this week (delegated to ScreenTimeService)
        const screenTimeMins = await this.screenTimeService.getScreenTimeForRange(
          kid.id,
          weekStart,
          weekEnd,
        );

        // Stars earned (assuming daily challenge completions)
        const starsEarned = await this.prisma.dailyChallengeAssignment.count({
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
        const badgesEarned = await this.prisma.rewardRedemption.count({
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
   * Mark a story as completed
   */
  async completeStory(kidId: string, storyId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      select: { parentId: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Update or create progress record
    const progress = await this.prisma.storyProgress.upsert({
      where: {
        kidId_storyId: {
          kidId,
          storyId,
        },
      },
      update: {
        completed: true,
        progress: 100,
        lastAccessed: new Date(),
      },
      create: {
        kidId,
        storyId,
        completed: true,
        progress: 100,
        lastAccessed: new Date(),
      },
    });

    // Trigger badge progress for story read
    await this.badgeProgressEngine.recordActivity(
      kid.parentId,
      'story_read',
      kidId,
      { storyId, duration: progress.totalTimeSpent },
    );

    return progress;
  }

  /**
   * Get detailed report for a specific kid
   */
  async getKidDetailedReport(kidId: string): Promise<KidDetailedReportDto> {
    const kid = await this.prisma.kid.findUnique({
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

    // Screen time today (delegated to ScreenTimeService)
    const screenTimeMins = await this.screenTimeService.getTodayScreenTime(kidId);
    const screenTimeLimitMins = await this.screenTimeService.getEffectiveDailyLimit(kidId);
    const screenTimeRemainingMins =
      screenTimeLimitMins !== null
        ? Math.max(0, screenTimeLimitMins - screenTimeMins)
        : undefined;

    // Stories this week
    const storiesCompleted = await this.prisma.storyProgress.count({
      where: {
        kidId,
        completed: true,
        lastAccessed: { gte: weekStart },
      },
    });

    const storiesInProgress = await this.prisma.storyProgress.count({
      where: {
        kidId,
        completed: false,
      },
    });

    // Quiz performance this week
    const answers = await this.prisma.questionAnswer.findMany({
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
    const starsEarned = await this.prisma.dailyChallengeAssignment.count({
      where: {
        kidId,
        completed: true,
        completedAt: { gte: weekStart },
      },
    });

    // Badges earned this week
    const badgesEarned = await this.prisma.rewardRedemption.count({
      where: {
        kidId,
        redeemedAt: { gte: weekStart },
      },
    });

    // Favorites count
    const favoritesCount = await this.prisma.favorite.count({
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
