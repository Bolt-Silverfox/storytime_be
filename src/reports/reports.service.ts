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
import { BadgeProgressEngine } from '../achievement-progress/badge-progress.engine';

const prisma = new PrismaClient();

@Injectable()
export class ReportsService {
  constructor(private badgeProgressEngine: BadgeProgressEngine) { }
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

    // Trigger badge progress for quiz answered
    const kid = await prisma.kid.findUnique({
      where: { id: dto.kidId },
      select: { parentId: true },
    });

    if (kid?.parentId) {
      await this.badgeProgressEngine.recordActivity(
        kid.parentId,
        'quiz_answered',
        dto.kidId,
        { questionId: dto.questionId, isCorrect }
      );
    }

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
   * Mark a story as completed
   */
  async completeStory(kidId: string, storyId: string) {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      select: { parentId: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Update or create progress record
    const progress = await prisma.storyProgress.upsert({
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
      { storyId, duration: progress.totalTimeSpent }
    );

    return progress;
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
  // ============== NEW FEATURES - CUSTOM DATE RANGE ==============
  /**
   * Get report for a kid within a custom date range
   */
  async getCustomRangeReport(
    kidId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Normalize dates
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Parallel queries for performance
    const [
      storiesCompleted,
      screenTimeMins,
      starsEarned,
      badgesEarned,
      answers,
    ] = await Promise.all([
      prisma.storyProgress.count({
        where: {
          kidId,
          completed: true,
          lastAccessed: { gte: start, lte: end },
        },
      }),
      this.getScreenTimeForRange(kidId, start, end),
      prisma.dailyChallengeAssignment.count({
        where: {
          kidId,
          completed: true,
          completedAt: { gte: start, lte: end },
        },
      }),
      prisma.rewardRedemption.count({
        where: {
          kidId,
          redeemedAt: { gte: start, lte: end },
        },
      }),
      prisma.questionAnswer.findMany({
        where: {
          kidId,
          answeredAt: { gte: start, lte: end },
        },
        select: { isCorrect: true },
      }),
    ]);

    const rightAnswers = answers.filter((a) => a.isCorrect).length;
    const totalAnswers = answers.length;
    const accuracyPercentage =
      totalAnswers > 0 ? Math.round((rightAnswers / totalAnswers) * 100) : 0;

    return {
      startDate: start,
      endDate: end,
      kidId: kid.id,
      kidName: kid.name || 'Unknown',
      avatarUrl: kid.avatar?.url,
      storiesCompleted,
      screenTimeMins,
      starsEarned,
      badgesEarned,
      rightAnswers,
      totalAnswers,
      accuracyPercentage,
    };
  }

  // ============== NEW FEATURES - DAILY BREAKDOWN ==============
  /**
   * Get daily breakdown for a kid for a given week
   */
  async getDailyBreakdown(kidId: string, weekStart?: Date): Promise<any> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      select: { id: true, name: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Calculate week boundaries
    const start = weekStart ? new Date(weekStart) : this.getWeekStart();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    const dailyBreakdown = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Generate data for each day of the week
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      // Parallel queries for each day
      const [screenTimeSessions, storiesCompleted, quizAnswers] =
        await Promise.all([
          prisma.screenTimeSession.findMany({
            where: {
              kidId,
              date: { gte: dayStart, lt: dayEnd },
              endTime: { not: null },
            },
            select: { duration: true },
          }),
          prisma.storyProgress.count({
            where: {
              kidId,
              completed: true,
              lastAccessed: { gte: dayStart, lte: dayEnd },
            },
          }),
          prisma.questionAnswer.findMany({
            where: {
              kidId,
              answeredAt: { gte: dayStart, lte: dayEnd },
            },
            select: { isCorrect: true },
          }),
        ]);

      const screenTimeMins = Math.floor(
        screenTimeSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60,
      );
      const quizzesTaken = quizAnswers.length;
      const correctAnswers = quizAnswers.filter((a) => a.isCorrect).length;
      const accuracyPercentage =
        quizzesTaken > 0
          ? Math.round((correctAnswers / quizzesTaken) * 100)
          : 0;

      dailyBreakdown.push({
        date: dayStart,
        dayOfWeek: dayNames[dayStart.getDay()],
        screenTimeMins,
        storiesCompleted,
        quizzesTaken,
        accuracyPercentage,
      });
    }

    return {
      kidId: kid.id,
      kidName: kid.name || 'Unknown',
      weekStartDate: start,
      weekEndDate: end,
      dailyBreakdown,
    };
  }

  /**
   * Helper to get week start (Monday)
   */
  private getWeekStart(date?: Date): Date {
    const now = date || new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  // ============== NEW FEATURES - ACTIVITY CATEGORIES ==============
  /**
   * Get activity breakdown by category for a kid
   */
  async getActivityCategories(
    kidId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      select: { id: true, name: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Fetch all relevant data in parallel
    const [storyProgress, quizAnswers, screenTimeSessions] = await Promise.all([
      prisma.storyProgress.findMany({
        where: {
          kidId,
          lastAccessed: { gte: start, lte: end },
        },
        select: {
          totalTimeSpent: true,
          completed: true,
        },
      }),
      prisma.questionAnswer.findMany({
        where: {
          kidId,
          answeredAt: { gte: start, lte: end },
        },
        select: {
          id: true,
        },
      }),
      prisma.screenTimeSession.findMany({
        where: {
          kidId,
          date: { gte: start, lt: end },
          endTime: { not: null },
        },
        select: { duration: true },
      }),
    ]);

    // Calculate category breakdowns
    const totalScreenTimeMins = Math.floor(
      screenTimeSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60,
    );

    const storyTimeMins = Math.floor(
      storyProgress.reduce((sum, p) => sum + (p.totalTimeSpent || 0), 0) / 60,
    );
    const storyCount = storyProgress.filter((p) => p.completed).length;

    const quizTimeMins = Math.floor(quizAnswers.length * 2); // Assume 2 mins per quiz
    const quizCount = quizAnswers.length;

    // Estimate other categories (these would need proper tracking in production)
    const playTimeMins = Math.floor(totalScreenTimeMins * 0.2);
    const creativityMins = Math.floor(totalScreenTimeMins * 0.15);
    const offTheCuffMins = Math.floor(totalScreenTimeMins * 0.1);

    const categories = [
      {
        category: 'stories',
        categoryLabel: 'Stories',
        timeMins: storyTimeMins,
        count: storyCount,
        percentage: totalScreenTimeMins > 0 
          ? Math.round((storyTimeMins / totalScreenTimeMins) * 100) 
          : 0,
      },
      {
        category: 'quiz',
        categoryLabel: 'Quiz',
        timeMins: quizTimeMins,
        count: quizCount,
        percentage: totalScreenTimeMins > 0 
          ? Math.round((quizTimeMins / totalScreenTimeMins) * 100) 
          : 0,
      },
      {
        category: 'play_time',
        categoryLabel: 'Play Time',
        timeMins: playTimeMins,
        count: 0,
        percentage: totalScreenTimeMins > 0 
          ? Math.round((playTimeMins / totalScreenTimeMins) * 100) 
          : 0,
      },
      {
        category: 'creativity',
        categoryLabel: 'Creativity',
        timeMins: creativityMins,
        count: 0,
        percentage: totalScreenTimeMins > 0 
          ? Math.round((creativityMins / totalScreenTimeMins) * 100) 
          : 0,
      },
      {
        category: 'off_the_cuff',
        categoryLabel: 'Off-the-Cuff',
        timeMins: offTheCuffMins,
        count: 0,
        percentage: totalScreenTimeMins > 0 
          ? Math.round((offTheCuffMins / totalScreenTimeMins) * 100) 
          : 0,
      },
    ];

    return {
      kidId: kid.id,
      kidName: kid.name || 'Unknown',
      startDate: start,
      endDate: end,
      categories,
      totalTimeMins: totalScreenTimeMins,
    };
  }

  // ============== NEW FEATURES - WEEK-OVER-WEEK COMPARISON ==============
  /**
   * Get week-over-week comparison for a kid
   */
  async getWeekComparison(kidId: string): Promise<any> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Current week
    const currentWeekStart = this.getWeekStart();
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 7);

    // Previous week
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7);
    const previousWeekEnd = new Date(currentWeekStart);

    // Fetch data for both weeks in parallel
    const [
      currentWeekData,
      previousWeekData,
    ] = await Promise.all([
      this.getWeekData(kidId, currentWeekStart, currentWeekEnd),
      this.getWeekData(kidId, previousWeekStart, previousWeekEnd),
    ]);

    const createComparison = (current: number, previous: number) => {
      const change = current - previous;
      const changePercentage = previous > 0 
        ? Math.round((change / previous) * 100) 
        : 0;
      return {
        currentWeekValue: current,
        previousWeekValue: previous,
        change,
        changePercentage,
        isIncrease: change > 0,
      };
    };

    return {
      kidId: kid.id,
      kidName: kid.name || 'Unknown',
      avatarUrl: kid.avatar?.url,
      currentWeekStart,
      currentWeekEnd,
      screenTime: createComparison(
        currentWeekData.screenTimeMins,
        previousWeekData.screenTimeMins,
      ),
      storiesCompleted: createComparison(
        currentWeekData.storiesCompleted,
        previousWeekData.storiesCompleted,
      ),
      quizAccuracy: createComparison(
        currentWeekData.quizAccuracy,
        previousWeekData.quizAccuracy,
      ),
      starsEarned: createComparison(
        currentWeekData.starsEarned,
        previousWeekData.starsEarned,
      ),
    };
  }

  /**
   * Helper to get week data
   */
  private async getWeekData(
    kidId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<any> {
    const [
      screenTimeMins,
      storiesCompleted,
      starsEarned,
      answers,
    ] = await Promise.all([
      this.getScreenTimeForRange(kidId, weekStart, weekEnd),
      prisma.storyProgress.count({
        where: {
          kidId,
          completed: true,
          lastAccessed: { gte: weekStart, lt: weekEnd },
        },
      }),
      prisma.dailyChallengeAssignment.count({
        where: {
          kidId,
          completed: true,
          completedAt: { gte: weekStart, lt: weekEnd },
        },
      }),
      prisma.questionAnswer.findMany({
        where: {
          kidId,
          answeredAt: { gte: weekStart, lt: weekEnd },
        },
        select: { isCorrect: true },
      }),
    ]);

    const correctAnswers = answers.filter((a) => a.isCorrect).length;
    const quizAccuracy = answers.length > 0 
      ? Math.round((correctAnswers / answers.length) * 100) 
      : 0;

    return {
      screenTimeMins,
      storiesCompleted,
      starsEarned,
      quizAccuracy,
    };
  }

  // ============== NEW FEATURES - QUIZ ACCURACY TRENDS ==============
  /**
   * Get quiz accuracy trends for a kid (last N weeks)
   */
  async getQuizTrends(kidId: string, weeksCount: number = 4): Promise<any> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      select: { id: true, name: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    const weeklyTrends = [];
    let totalQuestions = 0;
    let totalCorrect = 0;

    // Get data for each week
    for (let i = 0; i < weeksCount; i++) {
      const weekStart = this.getWeekStart();
      weekStart.setDate(weekStart.getDate() - (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const answers = await prisma.questionAnswer.findMany({
        where: {
          kidId,
          answeredAt: { gte: weekStart, lt: weekEnd },
        },
        select: { isCorrect: true },
      });

      const correctAnswers = answers.filter((a) => a.isCorrect).length;
      const accuracyPercentage = answers.length > 0 
        ? Math.round((correctAnswers / answers.length) * 100) 
        : 0;

      totalQuestions += answers.length;
      totalCorrect += correctAnswers;

      // Format week label
      const weekEndLabel = new Date(weekEnd);
      weekEndLabel.setDate(weekEnd.getDate() - 1);
      const weekLabel = `${this.formatDate(weekStart)} - ${this.formatDate(weekEndLabel)}`;

      weeklyTrends.unshift({
        date: weekStart,
        weekLabel,
        totalQuestions: answers.length,
        correctAnswers,
        accuracyPercentage,
      });
    }

    const overallAccuracy = totalQuestions > 0 
      ? Math.round((totalCorrect / totalQuestions) * 100) 
      : 0;

    return {
      kidId: kid.id,
      kidName: kid.name || 'Unknown',
      weeklyTrends,
      overallAccuracy,
      totalQuestions,
      totalCorrect,
    };
  }

  /**
   * Helper to format date as "MMM DD"
   */
  private formatDate(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }

}
