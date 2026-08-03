import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import {
  KidOverviewStatsDto,
  KidDetailedReportDto,
  WeeklyReportDto,
} from './dto/reports.dto';
import { SubmitQuestionAnswerDto } from '../story/dto/story.dto';
import { BadgeProgressEngine } from '../achievement-progress/badge-progress.engine';
import { ScreenTimeService } from './services/screen-time.service';
import {
  STORY_QUESTION_REPOSITORY,
  IStoryQuestionRepository,
  QUESTION_ANSWER_REPOSITORY,
  IQuestionAnswerRepository,
  KID_REPOSITORY,
  IKidRepository,
  STORY_PROGRESS_REPOSITORY,
  IStoryProgressRepository,
  DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY,
  IDailyChallengeAssignmentRepository,
  REWARD_REDEMPTION_REPOSITORY,
  IRewardRedemptionRepository,
  FAVORITE_REPOSITORY,
  IFavoriteRepository,
} from './repositories';

@Injectable()
export class ReportsService {
  constructor(
    @Inject(STORY_QUESTION_REPOSITORY)
    private readonly storyQuestionRepository: IStoryQuestionRepository,
    @Inject(QUESTION_ANSWER_REPOSITORY)
    private readonly questionAnswerRepository: IQuestionAnswerRepository,
    @Inject(KID_REPOSITORY)
    private readonly kidRepository: IKidRepository,
    @Inject(STORY_PROGRESS_REPOSITORY)
    private readonly storyProgressRepository: IStoryProgressRepository,
    @Inject(DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY)
    private readonly dailyChallengeAssignmentRepository: IDailyChallengeAssignmentRepository,
    @Inject(REWARD_REDEMPTION_REPOSITORY)
    private readonly rewardRedemptionRepository: IRewardRedemptionRepository,
    @Inject(FAVORITE_REPOSITORY)
    private readonly favoriteRepository: IFavoriteRepository,
    private readonly badgeProgressEngine: BadgeProgressEngine,
    private readonly screenTimeService: ScreenTimeService,
  ) {}

  /**
   * Record a question answer.
   *
   * Attribution is EITHER kid-scoped (dto.kidId) OR user-scoped (userId):
   * - kidId present  -> persist against the kid and advance that kid's badges.
   * - no kidId, user authenticated -> persist against the user (no badges;
   *   badges are kid-scoped).
   * - neither (guest) -> return the correctness result without persisting.
   */
  async recordAnswer(dto: SubmitQuestionAnswerDto, userId?: string) {
    const question = await this.storyQuestionRepository.findQuestionForAnswer(
      dto.questionId,
    );

    if (!question) {
      throw new BadRequestException('Question not found');
    }

    if (question.storyId !== dto.storyId) {
      throw new BadRequestException('Question does not belong to this story');
    }

    if (
      dto.selectedOption < 0 ||
      dto.selectedOption >= question.options.length
    ) {
      throw new BadRequestException('Invalid selectedOption index');
    }

    const isCorrect = question.correctOption === dto.selectedOption;

    // Guest with no kid context: nothing to attribute the answer to. Return the
    // correctness result so the client can still render feedback.
    if (!dto.kidId && !userId) {
      return { answerId: null, isCorrect, persisted: false };
    }

    // Kid attribution requires an authenticated parent who owns the kid —
    // otherwise anyone could persist answers (and advance badge progress)
    // against an arbitrary kidId.
    if (dto.kidId) {
      if (!userId) {
        throw new UnauthorizedException(
          'Authentication required to record kid-scoped answers',
        );
      }
      const kid = await this.kidRepository.findParentIdByKidId(dto.kidId);
      if (!kid || kid.parentId !== userId) {
        throw new ForbiddenException('Kid does not belong to this user');
      }
    }

    const answer = await this.questionAnswerRepository.createAnswer({
      // Prefer kid attribution when a kidId is supplied; otherwise attribute to
      // the authenticated user.
      kidId: dto.kidId ?? null,
      userId: dto.kidId ? null : userId,
      questionId: dto.questionId,
      storyId: dto.storyId,
      selectedOption: dto.selectedOption,
      isCorrect,
    });

    // Badge progress is kid-scoped — only advance it for kid-attributed answers.
    if (dto.kidId) {
      const kid = await this.kidRepository.findParentIdByKidId(dto.kidId);

      if (kid?.parentId) {
        await this.badgeProgressEngine.recordActivity(
          kid.parentId,
          'quiz_answered',
          dto.kidId,
          { questionId: dto.questionId, isCorrect },
        );
      }
    }

    return {
      answerId: answer.id,
      isCorrect,
      persisted: true,
    };
  }

  /**
   * Get weekly overview for all kids of a parent
   */
  async getWeeklyOverview(parentId: string): Promise<WeeklyReportDto> {
    const kids = await this.kidRepository.findKidsByParentWithAvatar(parentId);

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
        const storiesCompleted =
          await this.storyProgressRepository.countCompletedInRange(
            kid.id,
            weekStart,
            weekEnd,
          );

        // Screen time this week (delegated to ScreenTimeService)
        const screenTimeMins =
          await this.screenTimeService.getScreenTimeForRange(
            kid.id,
            weekStart,
            weekEnd,
          );

        // Stars earned (assuming daily challenge completions)
        const starsEarned =
          await this.dailyChallengeAssignmentRepository.countCompletedInRange(
            kid.id,
            weekStart,
            weekEnd,
          );

        // Badges earned (reward redemptions)
        const badgesEarned = await this.rewardRedemptionRepository.countInRange(
          kid.id,
          weekStart,
          weekEnd,
        );

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
    const kid = await this.kidRepository.findParentIdByKidId(kidId);

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Update or create progress record
    const progress = await this.storyProgressRepository.upsertCompletedProgress(
      kidId,
      storyId,
    );

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
    const kid = await this.kidRepository.findKidWithAvatarAndActivity(kidId);

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
    const screenTimeMins =
      await this.screenTimeService.getTodayScreenTime(kidId);
    const screenTimeLimitMins =
      await this.screenTimeService.getEffectiveDailyLimit(kidId);
    const screenTimeRemainingMins =
      screenTimeLimitMins !== null
        ? Math.max(0, screenTimeLimitMins - screenTimeMins)
        : undefined;

    // Stories this week
    const storiesCompleted =
      await this.storyProgressRepository.countCompletedSince(kidId, weekStart);

    const storiesInProgress =
      await this.storyProgressRepository.countInProgress(kidId);

    // Quiz performance this week
    const answers = await this.questionAnswerRepository.findAnswersByKidSince(
      kidId,
      weekStart,
    );

    const rightAnswers = answers.filter((a) => a.isCorrect).length;
    const totalAnswers = answers.length;
    const accuracyPercentage =
      totalAnswers > 0 ? Math.round((rightAnswers / totalAnswers) * 100) : 0;

    // Stars earned this week
    const starsEarned =
      await this.dailyChallengeAssignmentRepository.countCompletedSince(
        kidId,
        weekStart,
      );

    // Badges earned this week
    const badgesEarned = await this.rewardRedemptionRepository.countSince(
      kidId,
      weekStart,
    );

    // Favorites count
    const favoritesCount = await this.favoriteRepository.countByKid(kidId);

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
