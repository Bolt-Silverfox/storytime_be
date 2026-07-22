import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '../notification.service';

/**
 * Bridges the achievement module's `notification.badge_unlock` event (emitted by
 * BadgeProgressEngine after a badge unlocks) to an engagement notification for
 * the kid's parent.
 *
 * Adapts green's direct-call badge notification (which injected NotificationService
 * into BadgeService) to blue's event-listener architecture: BadgeService already
 * emits `badge.unlocked`, which BadgeProgressEngine forwards as
 * `notification.badge_unlock` for exactly this purpose.
 *
 * - `special` badges       -> AchievementUnlocked
 * - all other badge types  -> BadgeEarned
 *
 * Only fires when a kidId is present (per-kid unlock) so the kid's name can be
 * resolved and the parent-level aggregate record is not double-notified.
 * Best-effort: never throws (that would bubble back into the emitter).
 */
@Injectable()
export class EngagementEventListener {
  private readonly logger = new Logger(EngagementEventListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @OnEvent('notification.badge_unlock')
  async handleBadgeUnlock(payload: {
    userId: string;
    kidId?: string | null;
    badgeId: string;
    timestamp?: Date;
    type?: string;
  }): Promise<void> {
    // Only notify for a per-kid unlock: we need the kid's name and want to
    // avoid double-notifying for a parent-level aggregate record.
    if (!payload.kidId) {
      return;
    }
    try {
      const [kid, badge] = await Promise.all([
        this.prisma.kid.findUnique({
          where: { id: payload.kidId },
          select: { name: true },
        }),
        this.prisma.badge.findUnique({
          where: { id: payload.badgeId },
          select: { title: true, badgeType: true },
        }),
      ]);

      if (!badge) {
        this.logger.warn(
          `Badge ${payload.badgeId} not found; skipping engagement notification`,
        );
        return;
      }

      const kidName = kid?.name ?? 'Your child';

      // `special` badges represent one-off achievements; everything else
      // (count/streak/time progress badges) is surfaced as a badge earned.
      if (badge.badgeType === 'special') {
        await this.notificationService.sendNotification(
          'AchievementUnlocked',
          { kidName, achievementName: badge.title },
          payload.userId,
        );
      } else {
        await this.notificationService.sendNotification(
          'BadgeEarned',
          { kidName, badgeName: badge.title },
          payload.userId,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to emit badge-earned notification for user ${payload.userId}, kid ${payload.kidId}, badge ${payload.badgeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
