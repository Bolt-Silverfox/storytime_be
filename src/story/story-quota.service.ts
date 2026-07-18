import { Inject, Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from '../subscription/subscription.service';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import {
  STORY_REPOSITORY,
  IStoryRepository,
} from './repositories/story.repository.interface';

export interface StoryAccessResult {
  canAccess: boolean;
  reason?: 'already_read' | 'kid_created' | 'limit_reached' | 'premium';
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
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
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
    const isPremium = await this.subscriptionService.isPremiumUser(userId);
    if (isPremium) {
      return { canAccess: true, reason: 'premium' };
    }

    // 2. Check if story was already read (re-reading is always free).
    // Deliberately does NOT filter isDeleted — soft-deleted progress records
    // still count as "already read" so users can re-read after library removal.
    const existingProgress = await this.storyRepository.findUserStoryProgress(
      userId,
      storyId,
    );
    if (existingProgress) {
      return { canAccess: true, reason: 'already_read' };
    }

    // 3. Check if one of the user's kids created this story (always accessible)
    const createdByKid = await this.storyRepository.findStoryCreatedByKid(
      storyId,
      userId,
    );
    if (createdByKid) {
      return { canAccess: true, reason: 'kid_created' };
    }

    // 4. Get/create usage record with bonus calculation
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
    await this.storyRepository.executeTransaction(async (tx) => {
      // Check inside transaction to prevent race conditions
      const existing = await this.storyRepository.findUserStoryProgress(
        userId,
        storyId,
        tx,
      );

      if (existing) {
        return; // Already recorded, nothing to do
      }

      // Create UserStoryProgress record to mark story as "read"
      await this.storyRepository.createUserStoryProgressForQuota(
        userId,
        storyId,
        tx,
      );

      // Increment the unique stories count
      await this.storyRepository.upsertUserUsageForNewStory(
        userId,
        currentMonth,
        tx,
      );

      this.logger.debug(
        `Recorded new story access for user ${userId}, story ${storyId}`,
      );
    });
  }

  /**
   * Get user's story quota status
   */
  async getQuotaStatus(userId: string): Promise<StoryQuotaStatus> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);
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

    return await this.storyRepository.executeTransaction(async (tx) => {
      let usage = await this.storyRepository.findUserUsage(userId, tx);

      if (!usage) {
        // Create new usage record for first-time user
        // Don't set lastBonusGrantedAt yet - only set when base limit is exhausted
        usage = await this.storyRepository.createInitialUserUsage(
          userId,
          currentMonth,
          tx,
        );
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
        usage = await this.storyRepository.updateUserUsage(
          userId,
          { lastBonusGrantedAt: now },
          tx,
        );
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
        usage = await this.storyRepository.updateUserUsage(
          userId,
          {
            bonusStories: { increment: bonusesToGrant },
            lastBonusGrantedAt: now,
          },
          tx,
        );
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

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
