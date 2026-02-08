import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { BadgeService } from './badge.service';
import { PrismaService } from '../prisma/prisma.service';

interface BadgeEvent {
  userId: string;
  kidId?: string;
  timestamp: Date;
  metadata?: any;
}

@Injectable()
export class BadgeProgressEngine implements OnModuleInit {
  private readonly logger = new Logger(BadgeProgressEngine.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private badgeService: BadgeService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('BadgeProgressEngine initialized and listening for events');
  }

  // Record activity and trigger badge progress updates

  async recordActivity(
    userId: string,
    action: string,
    kidId?: string,
    metadata?: any,
  ): Promise<void> {
    try {
      // Log activity
      await this.prisma.activityLog.create({
        data: {
          userId,
          kidId,
          action,
          status: 'SUCCESS',
          createdAt: new Date(),
          ...(metadata && { details: JSON.stringify(metadata) }),
        },
      });

      // Emit corresponding badge events (pass kidId through)
      await this.handleBadgeEvent(userId, action, kidId, metadata);
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

  private async handleBadgeEvent(
    userId: string,
    action: string,
    kidId?: string,
    metadata?: any,
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
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      select: { parentId: true },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Use updateMany since there's no unique constraint
    await this.prisma.dailyChallengeAssignment.updateMany({
      where: { kidId, challengeId },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });

    const assignment = await this.prisma.dailyChallengeAssignment.findFirst({
      where: { kidId, challengeId },
    });

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
