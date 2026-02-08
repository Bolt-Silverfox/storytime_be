import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';

export interface StoryAccessResult {
  canAccess: boolean;
  reason?: 'already_read' | 'limit_reached' | 'premium';
  remaining?: number;
  totalAllowed?: number;
}

export interface StoryQuotaStatus {
  isPremium: boolean;
  unlimited: boolean;
  used?: number;
  baseLimit?: number;
  bonusStories?: number;
  totalAllowed?: number;
  remaining?: number;
}

@Injectable()
export class StoryQuotaService {
  private readonly logger = new Logger(StoryQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Check if user can access a story (either new or re-read)
   */
  async checkStoryAccess(
    userId: string,
    storyId: string,
  ): Promise<StoryAccessResult> {
    // 1. Check if premium user
    const isPremium = await this.isPremiumUser(userId);
    if (isPremium) {
      return { canAccess: true, reason: 'premium' };
    }

    // 2. Check if story was already read (re-reading is always free)
    const existingProgress = await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId } },
    });
    if (existingProgress) {
      return { canAccess: true, reason: 'already_read' };
    }

    // 3. Get/create usage record with bonus calculation
    const usage = await this.getOrCreateUsageWithBonus(userId);
    const totalAllowed =
      FREE_TIER_LIMITS.STORIES.BASE_LIMIT + usage.bonusStories;
    const remaining = totalAllowed - usage.uniqueStoriesRead;

    if (remaining <= 0) {
      this.logger.log(
        `User ${userId} reached story limit (${usage.uniqueStoriesRead}/${totalAllowed})`,
      );
      return {
        canAccess: false,
        reason: 'limit_reached',
        remaining: 0,
        totalAllowed,
      };
    }

    return { canAccess: true, remaining, totalAllowed };
  }

  /**
   * Record that a user accessed a NEW unique story
   * Should be called after user successfully accesses a story for the first time
   */
  async recordNewStoryAccess(userId: string, storyId: string): Promise<void> {
    const currentMonth = this.getCurrentMonth();

    // Use interactive transaction to handle race condition atomically
    await this.prisma.$transaction(async (tx) => {
      // Check inside transaction to prevent race conditions
      const existing = await tx.userStoryProgress.findUnique({
        where: { userId_storyId: { userId, storyId } },
      });

      if (existing) {
        return; // Already recorded, nothing to do
      }

      // Create UserStoryProgress record to mark story as "read"
      await tx.userStoryProgress.create({
        data: {
          userId,
          storyId,
          progress: 0,
        },
      });

      // Increment the unique stories count
      await tx.userUsage.upsert({
        where: { userId },
        create: {
          userId,
          currentMonth,
          uniqueStoriesRead: 1,
          lastBonusGrantedAt: new Date(),
        },
        update: {
          uniqueStoriesRead: { increment: 1 },
        },
      });

      this.logger.debug(
        `Recorded new story access for user ${userId}, story ${storyId}`,
      );
    });
  }

  /**
   * Get user's story quota status
   */
  async getQuotaStatus(userId: string): Promise<StoryQuotaStatus> {
    const isPremium = await this.isPremiumUser(userId);
    if (isPremium) {
      return { isPremium: true, unlimited: true };
    }

    const usage = await this.getOrCreateUsageWithBonus(userId);
    const totalAllowed =
      FREE_TIER_LIMITS.STORIES.BASE_LIMIT + usage.bonusStories;

    return {
      isPremium: false,
      unlimited: false,
      used: usage.uniqueStoriesRead,
      baseLimit: FREE_TIER_LIMITS.STORIES.BASE_LIMIT,
      bonusStories: usage.bonusStories,
      totalAllowed,
      remaining: Math.max(0, totalAllowed - usage.uniqueStoriesRead),
    };
  }

  /**
   * Get or create usage record, calculating and granting pending weekly bonuses.
   * Bonuses only start accruing AFTER the user exhausts their base limit.
   */
  private async getOrCreateUsageWithBonus(userId: string) {
    const now = new Date();
    const currentMonth = this.getCurrentMonth();
    const baseLimit = FREE_TIER_LIMITS.STORIES.BASE_LIMIT;

    return await this.prisma.$transaction(async (tx) => {
      let usage = await tx.userUsage.findUnique({ where: { userId } });

      if (!usage) {
        // Create new usage record for first-time user
        // Don't set lastBonusGrantedAt yet - only set when base limit is exhausted
        usage = await tx.userUsage.create({
          data: {
            userId,
            currentMonth,
            uniqueStoriesRead: 0,
            bonusStories: 0,
            lastBonusGrantedAt: null,
          },
        });
        return usage;
      }

      // Only start bonus accrual after user has exhausted base limit
      const hasExhaustedBaseLimit = usage.uniqueStoriesRead >= baseLimit;

      if (!hasExhaustedBaseLimit) {
        // User still has base stories available, no bonus accrual yet
        return usage;
      }

      // User has exhausted base limit - start or continue bonus accrual
      if (!usage.lastBonusGrantedAt) {
        // First time hitting limit - start tracking bonus from now
        usage = await tx.userUsage.update({
          where: { userId },
          data: { lastBonusGrantedAt: now },
        });
        this.logger.debug(
          `User ${userId} exhausted base limit, bonus accrual started`,
        );
        return usage;
      }

      // Calculate pending bonus stories to grant
      const bonusesToGrant = this.calculatePendingBonuses(
        usage.lastBonusGrantedAt,
        now,
      );

      if (bonusesToGrant > 0) {
        usage = await tx.userUsage.update({
          where: { userId },
          data: {
            bonusStories: { increment: bonusesToGrant },
            lastBonusGrantedAt: now,
          },
        });
        this.logger.debug(
          `Granted ${bonusesToGrant} bonus stories to user ${userId}`,
        );
      }

      return usage;
    });
  }

  /**
   * Calculate how many weekly bonuses are pending since last grant
   */
  private calculatePendingBonuses(lastGranted: Date | null, now: Date): number {
    if (!lastGranted) return 0;

    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const elapsed = now.getTime() - lastGranted.getTime();
    const weeksPassed = Math.floor(elapsed / msPerWeek);

    return weeksPassed * FREE_TIER_LIMITS.STORIES.WEEKLY_BONUS;
  }

  /**
   * Check if user has an active premium subscription (uses cached SubscriptionService)
   */
  private async isPremiumUser(userId: string): Promise<boolean> {
    return this.subscriptionService.isPremiumUser(userId);
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
