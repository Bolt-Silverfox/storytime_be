import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  KidOverviewStatsDto,
  KidDetailedReportDto,
  WeeklyReportDto,
  DailyLimitDto,
  WeeklySummaryDto,
  KidWeeklySummaryDataDto,
} from './reports.dto';
// import { SetDailyLimitDto } from '@/control/control.dto';
import { QuestionAnswerDto } from '../story/story.dto'; // Import from story module
import { GeminiService } from '../story/gemini.service';
import { Cron, CronExpression } from '@nestjs/schedule';

const prisma = new PrismaClient();



@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly geminiService: GeminiService) {}

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

  // ============== WEEKLY AI SUMMARY ==============

  /**
   * Get week start and end dates (Monday to Sunday)
   */
  private getWeekDates(weekStart?: Date): { weekStart: Date; weekEnd: Date } {
    const now = weekStart || new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Sunday
    const start = new Date(now);
    start.setDate(now.getDate() + diff);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    return { weekStart: start, weekEnd: end };
  }

  /**
   * Gather weekly summary data for a parent's kids
   */
  private async getWeeklySummaryData(
    parentId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<KidWeeklySummaryDataDto[]> {
    const kids = await prisma.kid.findMany({
      where: { parentId },
    });

    const kidsData: KidWeeklySummaryDataDto[] = await Promise.all(
      kids.map(async (kid) => {
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

        // Stories in progress
        const storiesInProgress = await prisma.storyProgress.count({
          where: {
            kidId: kid.id,
            completed: false,
          },
        });

        // Screen time this week
        const screenTimeMins = await this.getScreenTimeForRange(
          kid.id,
          weekStart,
          weekEnd,
        );

        // Screen time limit
        const screenTimeLimitMins = await this.getEffectiveDailyLimit(kid.id);

        // Quiz performance this week
        const answers = await prisma.questionAnswer.findMany({
          where: {
            kidId: kid.id,
            answeredAt: { gte: weekStart, lt: weekEnd },
          },
        });

        const rightAnswers = answers.filter((a) => a.isCorrect).length;
        const totalQuizAnswers = answers.length;
        const quizAccuracyPercentage =
          totalQuizAnswers > 0
            ? Math.round((rightAnswers / totalQuizAnswers) * 100)
            : 0;

        // Daily challenges completed this week
        const dailyChallengesCompleted =
          await prisma.dailyChallengeAssignment.count({
            where: {
              kidId: kid.id,
              completed: true,
              completedAt: { gte: weekStart, lt: weekEnd },
            },
          });

        // Favorites added this week
        const favoritesAdded = await prisma.favorite.count({
          where: {
            kidId: kid.id,
            createdAt: { gte: weekStart, lt: weekEnd },
          },
        });

        // Stars earned (daily challenges)
        const starsEarned = dailyChallengesCompleted;

        // Badges earned (reward redemptions)
        const badgesEarned = await prisma.rewardRedemption.count({
          where: {
            kidId: kid.id,
            redeemedAt: { gte: weekStart, lt: weekEnd },
          },
        });

        return {
          kidId: kid.id,
          kidName: kid.name || 'Unknown',
          ageRange: kid.ageRange || undefined,
          storiesCompleted,
          storiesInProgress,
          screenTimeMins,
          screenTimeLimitMins,
          quizAccuracyPercentage,
          totalQuizAnswers,
          dailyChallengesCompleted,
          favoritesAdded,
          starsEarned,
          badgesEarned,
        };
      }),
    );

    return kidsData;
  }

  /**
   * Build AI prompt for weekly summary
   */
  private buildWeeklySummaryPrompt(
    kidsData: KidWeeklySummaryDataDto[],
    weekStart: Date,
    weekEnd: Date,
  ): string {
    const formatDate = (date: Date) =>
      date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

    let prompt = `Generate a warm, encouraging weekly summary for a parent about their children's reading and learning activity.

Week: ${formatDate(weekStart)} to ${formatDate(weekEnd)}

`;

    if (kidsData.length === 0) {
      prompt += `No children data available for this week.

Please write a brief, encouraging message suggesting the parent to add their children to the platform.`;
    } else {
      prompt += `Children's Activity:\n\n`;

      kidsData.forEach((kid, index) => {
        prompt += `${index + 1}. ${kid.kidName}${kid.ageRange ? ` (Age ${kid.ageRange})` : ''}
   - Stories completed: ${kid.storiesCompleted}
   - Stories in progress: ${kid.storiesInProgress}
   - Screen time: ${kid.screenTimeMins} minutes${kid.screenTimeLimitMins ? ` / ${kid.screenTimeLimitMins} min daily limit` : ''}
   - Quiz accuracy: ${kid.quizAccuracyPercentage}% (${kid.totalQuizAnswers} questions answered)
   - Daily challenges completed: ${kid.dailyChallengesCompleted}/7
   - New favorites added: ${kid.favoritesAdded}
   - Stars earned: ${kid.starsEarned}
   - Badges earned: ${kid.badgesEarned}

`;
      });

      prompt += `Please write a warm, encouraging 2-3 paragraph summary that:
1. Highlights key achievements and progress for each child
2. Notes any notable improvements, patterns, or areas of excellence
3. Provides gentle, positive suggestions for continued growth
4. Celebrates the family's overall engagement with reading

Keep the tone:
- Warm and supportive (like a friendly teacher)
- Specific to the data provided
- Encouraging without being overly effusive
- Parent-friendly and easy to understand

Do NOT use phrases like "Here's your summary" or "This week's report". Start directly with the content.`;
    }

    return prompt;
  }

  /**
   * Generate weekly AI summary for a parent
   */
  async generateWeeklySummary(
    parentId: string,
    weekStart?: Date,
  ): Promise<WeeklySummaryDto> {
    try {
      const { weekStart: start, weekEnd: end } = this.getWeekDates(weekStart);

      // Gather data
      const kidsData = await this.getWeeklySummaryData(parentId, start, end);

      // Build prompt
      const prompt = this.buildWeeklySummaryPrompt(kidsData, start, end);

      // Generate AI summary
      this.logger.log(`Generating weekly summary for parent ${parentId}`);
      const model = this.geminiService['genAI']?.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      if (!model) {
        throw new Error('Gemini AI is not configured');
      }

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text();

      // Calculate totals
      const totalStoriesCompleted = kidsData.reduce(
        (sum, kid) => sum + kid.storiesCompleted,
        0,
      );
      const totalScreenTimeMins = kidsData.reduce(
        (sum, kid) => sum + kid.screenTimeMins,
        0,
      );

      this.logger.log(
        `Successfully generated weekly summary for parent ${parentId}`,
      );

      return {
        parentId,
        weekStartDate: start,
        weekEndDate: end,
        kidsData,
        summary,
        generatedAt: new Date(),
        totalStoriesCompleted,
        totalScreenTimeMins,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate weekly summary for parent ${parentId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get weekly summary (generate on-demand)
   */
  async getWeeklySummary(
    parentId: string,
    weekStart?: Date,
  ): Promise<WeeklySummaryDto> {
    return this.generateWeeklySummary(parentId, weekStart);
  }

  /**
   * Cron job: Generate weekly summaries for all parents
   * Runs every Sunday at 8 PM
   */
  @Cron('0 20 * * 0') // Every Sunday at 8 PM
  async generateWeeklySummariesForAllParents() {
    try {
      this.logger.log('Starting weekly summary generation for all parents');

      // Get all parents with kids
      const parents = await prisma.user.findMany({
        where: {
          kids: {
            some: {},
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      this.logger.log(`Found ${parents.length} parents with children`);

      let successCount = 0;
      let errorCount = 0;

      for (const parent of parents) {
        try {
          await this.generateWeeklySummary(parent.id);
          successCount++;
          this.logger.log(
            `Generated summary for parent ${parent.name || parent.email}`,
          );
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to generate summary for parent ${parent.name || parent.email}:`,
            error,
          );
        }
      }

      this.logger.log(
        `Weekly summary generation complete. Success: ${successCount}, Errors: ${errorCount}`,
      );
    } catch (error) {
      this.logger.error('Failed to generate weekly summaries:', error);
    }
  }
}
