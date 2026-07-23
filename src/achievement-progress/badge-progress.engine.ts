import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { BadgeService } from './badge.service';
import { StreakService } from './streak.service';
import { NotificationService } from '../notification/notification.service';
import { BadgeMetadata } from './badge.constants';
import {
  STREAK_REPOSITORY,
  IStreakRepository,
  KID_REPOSITORY,
  IKidRepository,
  DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY,
  IDailyChallengeAssignmentRepository,
} from './repositories';

interface BadgeEvent {
  userId: string;
  kidId?: string;
  timestamp: Date;
  metadata?: BadgeMetadata;
}

@Injectable()
export class BadgeProgressEngine implements OnModuleInit {
  private readonly logger = new Logger(BadgeProgressEngine.name);

  // Streak lengths (in days) that trigger a milestone notification.
  private readonly STREAK_MILESTONES = [3, 7, 30];

  constructor(
    private eventEmitter: EventEmitter2,
    private badgeService: BadgeService,
    private readonly streakService: StreakService,
    private readonly notificationService: NotificationService,
    @Inject(STREAK_REPOSITORY)
    private readonly streakRepository: IStreakRepository,
    @Inject(KID_REPOSITORY)
    private readonly kidRepository: IKidRepository,
    @Inject(DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY)
    private readonly dailyChallengeAssignmentRepository: IDailyChallengeAssignmentRepository,
  ) {}

  onModuleInit() {
    this.logger.log('BadgeProgressEngine initialized and listening for events');
  }

  // Record activity and trigger badge progress updates

  async recordActivity(
    userId: string,
    action: string,
    kidId?: string,
    metadata?: BadgeMetadata,
  ): Promise<void> {
    try {
      // Detect whether this is the kid's first activity today BEFORE logging,
      // so we only evaluate a streak milestone on the day the streak grows.
      // Best-effort: a failure here must not abort the core activity flow, so
      // default to `true` (skip the uncertain milestone) and keep going.
      let hadActivityToday = true;
      if (kidId) {
        try {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const lastActivity =
            await this.streakRepository.findLastKidActivity(kidId);
          hadActivityToday =
            lastActivity !== null && lastActivity.createdAt >= startOfToday;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to check today's activity for kid ${kidId}; skipping streak milestone evaluation: ${message}`,
          );
        }
      }

      // Log activity
      await this.streakRepository.createActivityLog({
        userId,
        kidId,
        action,
        status: 'SUCCESS',
        createdAt: new Date(),
        ...(metadata && { details: JSON.stringify(metadata) }),
      });

      // Emit corresponding badge events (pass kidId through)
      await this.handleBadgeEvent(userId, action, kidId, metadata);

      // If the streak just advanced today (first activity of the day),
      // notify the parent when it lands on a milestone threshold.
      if (kidId && !hadActivityToday) {
        await this.maybeEmitStreakMilestone(userId, kidId);
      }
    } catch (error) {
      this.logger.error(
        `Error recording activity: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('story.completed')
  async handleStoryCompleted(event: BadgeEvent) {
    this.logger.log(`Story completed event: ${event.userId}`);
    await this.badgeService.updateBadgeProgress(
      event.userId,
      'story_read',
      1,
      event.metadata,
      event.kidId,
    );
  }

  @OnEvent('challenge.completed')
  async handleChallengeCompleted(event: BadgeEvent) {
    this.logger.log(`Challenge completed event: ${event.userId}`);
    await this.badgeService.updateBadgeProgress(
      event.userId,
      'challenge_completed',
      1,
      event.metadata,
      event.kidId,
    );
  }

  @OnEvent('quiz.answered')
  async handleQuizAnswered(event: BadgeEvent & { isCorrect: boolean }) {
    this.logger.log(
      `Quiz answered event: ${event.userId}, correct: ${event.isCorrect}`,
    );
    await this.badgeService.updateBadgeProgress(
      event.userId,
      'quiz_answered',
      1,
      { isCorrect: event.isCorrect },
      event.kidId,
    );
  }

  @OnEvent('user.login')
  handleUserLogin(event: BadgeEvent) {
    this.logger.log(`User login event: ${event.userId}`);
    // Could track login streak badges here
  }

  /**
   * Notify the parent when a kid's reading streak reaches a milestone.
   * `parentUserId` is the parent (owning) user id. Never throws.
   */
  private async maybeEmitStreakMilestone(
    parentUserId: string,
    kidId: string,
  ): Promise<void> {
    try {
      const { currentStreak } =
        await this.streakService.getStreakSummaryForKid(kidId);

      if (!this.STREAK_MILESTONES.includes(currentStreak)) {
        return;
      }

      const kid = await this.kidRepository.findNameById(kidId);
      const kidName = kid?.name ?? 'Your child';

      await this.notificationService.sendNotification(
        'StreakMilestone',
        { kidName, days: currentStreak },
        parentUserId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit streak-milestone notification for user ${parentUserId}, kid ${kidId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async handleBadgeEvent(
    userId: string,
    action: string,
    kidId?: string,
    metadata?: BadgeMetadata,
  ): Promise<void> {
    // Map action to badge event types
    const eventMap: Record<string, string> = {
      story_read: 'story_read',
      challenge_completed: 'challenge_completed',
      quiz_answered: 'quiz_answered',
      login: 'activity_log',
    };

    const badgeType = eventMap[action];
    if (!badgeType) {
      return;
    }

    await this.badgeService.updateBadgeProgress(
      userId,
      badgeType,
      1,
      metadata,
      kidId,
    );
  }

  /**
   * Mark a daily challenge as completed
   */
  async completeDailyChallenge(kidId: string, challengeId: string) {
    const kid = await this.kidRepository.findParentIdById(kidId);

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Use updateMany since there's no unique constraint
    await this.dailyChallengeAssignmentRepository.markCompleted(
      kidId,
      challengeId,
    );

    const assignment =
      await this.dailyChallengeAssignmentRepository.findFirstByKidAndChallenge(
        kidId,
        challengeId,
      );

    // Trigger badge progress
    await this.recordActivity(kid.parentId, 'challenge_completed', kidId, {
      challengeId,
    });

    return assignment;
  }

  // Emit badge unlock event for notification system

  @OnEvent('badge.unlocked')
  handleBadgeUnlocked(payload: {
    userId: string;
    badgeId: string;
    timestamp: Date;
  }) {
    this.logger.log(
      `Badge unlocked: ${payload.badgeId} for user ${payload.userId}`,
    );

    // Forward to notification service
    this.eventEmitter.emit('notification.badge_unlock', {
      ...payload,
      type: 'badge_unlock',
    });
  }
}
