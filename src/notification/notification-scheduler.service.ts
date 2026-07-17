import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

/**
 * Scheduled emitter for engagement / reminder notifications.
 *
 * Each job queries a bounded, indexed set of users and dispatches an in-app
 * notification per user via NotificationService.sendNotification. sendNotification
 * already filters delivery by the user's notification preferences, so jobs never
 * re-implement preference filtering. Every send is wrapped in try/catch so a
 * single failure never aborts the batch, and each job logs a summary count.
 */

// --- Thresholds -----------------------------------------------------------
/** Send a subscription reminder when the plan renews/expires within this many days. */
const SUBSCRIPTION_REMINDER_DAYS = 3;
/** Consider a user lapsed (WeMissYou) after this many days without reading activity. */
const INACTIVITY_DAYS = 7;
/** Remind about an in-progress story untouched for at least this many days. */
const INCOMPLETE_STORY_STALE_DAYS = 3;
/** Max rows fetched per query / per pagination page — keeps every batch bounded. */
const BATCH_LIMIT = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * SubscriptionReminder — daily at 09:00.
   * Subscriptions (model Subscription) whose `endsAt` falls within the next
   * SUBSCRIPTION_REMINDER_DAYS days. Uses the `@@index([status, isDeleted])`.
   */
  @Cron('0 9 * * *', { name: 'subscriptionReminder' })
  async sendSubscriptionReminders(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + SUBSCRIPTION_REMINDER_DAYS * MS_PER_DAY,
    );

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        isDeleted: false,
        endsAt: { gte: now, lte: windowEnd },
      },
      select: { userId: true, plan: true, endsAt: true },
      take: BATCH_LIMIT,
    });

    let sent = 0;
    let failed = 0;
    for (const sub of subscriptions) {
      if (!sub.endsAt) continue;
      const daysLeft = Math.max(
        1,
        Math.ceil((sub.endsAt.getTime() - now.getTime()) / MS_PER_DAY),
      );
      try {
        await this.notificationService.sendNotification(
          'SubscriptionReminder',
          { plan: sub.plan, daysLeft },
          sub.userId,
        );
        sent++;
      } catch (err) {
        failed++;
        this.logger.error(
          `SubscriptionReminder failed for user ${sub.userId}: ${
            (err as Error).message
          }`,
        );
      }
    }
    this.logger.log(
      `SubscriptionReminder: ${sent} sent, ${failed} failed (${subscriptions.length} candidates)`,
    );
  }

  /**
   * WeMissYou — daily at 10:00.
   * Signal: UserStoryProgress.lastAccessed (the per-user reading-activity table
   * that backs "continue reading"). Targets users who have read at least once
   * but have no progress touched within INACTIVITY_DAYS.
   */
  @Cron('0 10 * * *', { name: 'weMissYou' })
  async sendWeMissYouReminders(): Promise<void> {
    const cutoff = new Date(Date.now() - INACTIVITY_DAYS * MS_PER_DAY);

    let sent = 0;
    let failed = 0;
    let candidates = 0;
    let cursor: string | undefined;

    // Paginate over lapsed users by id cursor so each page stays bounded.
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          isDeleted: false,
          isSuspended: false,
          name: { not: null },
          // Has read at least once...
          userStoryProgress: { some: {} },
          // ...but nothing accessed within the inactivity window.
          NOT: {
            userStoryProgress: { some: { lastAccessed: { gte: cutoff } } },
          },
        },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
        take: BATCH_LIMIT,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (users.length === 0) break;
      candidates += users.length;

      for (const user of users) {
        try {
          await this.notificationService.sendNotification(
            'WeMissYou',
            { name: user.name },
            user.id,
          );
          sent++;
        } catch (err) {
          failed++;
          this.logger.error(
            `WeMissYou failed for user ${user.id}: ${(err as Error).message}`,
          );
        }
      }

      if (users.length < BATCH_LIMIT) break;
      cursor = users[users.length - 1].id;
    }

    this.logger.log(
      `WeMissYou: ${sent} sent, ${failed} failed (${candidates} candidates)`,
    );
  }

  /**
   * IncompleteStoryReminder — daily at 11:00.
   * Uses UserStoryProgress (the table backing getUserContinueReading): rows with
   * completed=false and lastAccessed older than INCOMPLETE_STORY_STALE_DAYS.
   * `distinct: ['userId']` + lastAccessed-desc ordering yields the most recently
   * touched stale story per user, so each user is reminded once.
   */
  @Cron('0 11 * * *', { name: 'incompleteStoryReminder' })
  async sendIncompleteStoryReminders(): Promise<void> {
    const cutoff = new Date(
      Date.now() - INCOMPLETE_STORY_STALE_DAYS * MS_PER_DAY,
    );

    const progressRows = await this.prisma.userStoryProgress.findMany({
      where: {
        completed: false,
        isDeleted: false,
        lastAccessed: { lt: cutoff },
        story: { isDeleted: false },
        user: { isDeleted: false, isSuspended: false },
      },
      distinct: ['userId'],
      orderBy: [{ userId: 'asc' }, { lastAccessed: 'desc' }],
      select: {
        userId: true,
        story: { select: { title: true } },
      },
      take: BATCH_LIMIT,
    });

    let sent = 0;
    let failed = 0;
    for (const row of progressRows) {
      try {
        await this.notificationService.sendNotification(
          'IncompleteStoryReminder',
          { storyTitle: row.story.title },
          row.userId,
        );
        sent++;
      } catch (err) {
        failed++;
        this.logger.error(
          `IncompleteStoryReminder failed for user ${row.userId}: ${
            (err as Error).message
          }`,
        );
      }
    }
    this.logger.log(
      `IncompleteStoryReminder: ${sent} sent, ${failed} failed (${progressRows.length} candidates)`,
    );
  }

  /**
   * DailyListeningReminder — daily at 18:00.
   * Nudges all active users to listen today. sendNotification enforces the
   * user's DAILY_LISTENING_REMINDER preference, so opted-out users are skipped
   * downstream. Paginated by id cursor to stay bounded across the full user base.
   */
  @Cron('0 18 * * *', { name: 'dailyListeningReminder' })
  async sendDailyListeningReminders(): Promise<void> {
    let sent = 0;
    let failed = 0;
    let candidates = 0;
    let cursor: string | undefined;

    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          isDeleted: false,
          isSuspended: false,
          name: { not: null },
        },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
        take: BATCH_LIMIT,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (users.length === 0) break;
      candidates += users.length;

      for (const user of users) {
        try {
          await this.notificationService.sendNotification(
            'DailyListeningReminder',
            { name: user.name },
            user.id,
          );
          sent++;
        } catch (err) {
          failed++;
          this.logger.error(
            `DailyListeningReminder failed for user ${user.id}: ${
              (err as Error).message
            }`,
          );
        }
      }

      if (users.length < BATCH_LIMIT) break;
      cursor = users[users.length - 1].id;
    }

    this.logger.log(
      `DailyListeningReminder: ${sent} sent, ${failed} failed (${candidates} candidates)`,
    );
  }
}
