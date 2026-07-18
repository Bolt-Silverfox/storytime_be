import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  BadgeConstants,
  BadgeDefinition,
  BadgeMetadata,
} from './badge.constants';
import {
  BadgePreviewDto,
  BadgeDetailDto,
  FullBadgeListResponseDto,
} from './dto/badge-response.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  BADGE_REPOSITORY,
  IBadgeRepository,
  USER_BADGE_REPOSITORY,
  IUserBadgeRepository,
  KID_REPOSITORY,
  IKidRepository,
} from './repositories';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    @Inject(BADGE_REPOSITORY)
    private readonly badgeRepository: IBadgeRepository,
    @Inject(USER_BADGE_REPOSITORY)
    private readonly userBadgeRepository: IUserBadgeRepository,
    @Inject(KID_REPOSITORY)
    private readonly kidRepository: IKidRepository,
    private badgeConstants: BadgeConstants,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Initialize badges for a new user
   */
  async initializeUserBadges(userId: string): Promise<void> {
    const badges = await this.badgeRepository.findAll();
    if (badges.length === 0) {
      this.logger.warn('No badges found in catalog. Run seed first.');
      return;
    }

    // Fetch kids for user and create per-kid and parent-level badge records
    const kids = await this.kidRepository.findIdsByParent(userId);

    const txOps: Prisma.UserBadgeUncheckedCreateInput[] = [];

    for (const badge of badges) {
      // Parent-level (kidId omitted)
      txOps.push({
        userId,
        badgeId: badge.id,
        count: 0,
        unlocked: false,
      });

      // Per-kid badges
      for (const k of kids) {
        txOps.push({
          userId,
          kidId: k.id,
          badgeId: badge.id,
          count: 0,
          unlocked: false,
        });
      }
    }

    if (txOps.length > 0) {
      await this.userBadgeRepository.createUserBadgesInTransaction(txOps);
    }

    this.logger.log(
      `Initialized ${badges.length} badges for user ${userId} (including per-kid records)`,
    );
  }

  /**
   * Get badge preview (top 3 badges)
   */
  async getBadgePreview(
    userId: string,
    kidId?: string,
  ): Promise<BadgePreviewDto[]> {
    try {
      const where: { userId: string; kidId: string | null } = {
        userId,
        kidId: null,
      };
      if (typeof kidId !== 'undefined') {
        where.kidId = kidId;
      }

      const userBadges = await this.userBadgeRepository.findPreviewBadges(
        where,
        3,
      );

      // If less than 3, fill with locked badges
      if (userBadges.length < 3) {
        const where2: {
          userId: string;
          unlocked: boolean;
          id: { notIn: string[] };
          kidId: string | null;
        } = {
          userId,
          unlocked: false,
          id: { notIn: userBadges.map((ub) => ub.id) },
          kidId: typeof kidId === 'undefined' ? null : kidId,
        };

        const remaining =
          await this.userBadgeRepository.findRemainingPreviewBadges(
            where2,
            3 - userBadges.length,
          );
        userBadges.push(...remaining);
      }

      return userBadges.map((ub) => ({
        badgeId: ub.badge.id,
        title: ub.badge.title,
        iconUrl: ub.badge.iconUrl,
        locked: !ub.unlocked,
        count: ub.count,
      }));
    } catch (error) {
      this.logger.error(
        `Error fetching badge preview for user ${userId}:`,
        error,
      );
      return [];
    }
  }

  // Get full badge list with unlock status

  async getFullBadgeList(
    userId: string,
    kidId?: string,
  ): Promise<FullBadgeListResponseDto> {
    const whereAll: { userId: string; kidId: string | null } = {
      userId,
      kidId: typeof kidId === 'undefined' ? null : kidId,
    };

    const userBadges =
      await this.userBadgeRepository.findFullBadgeList(whereAll);

    const badges: BadgeDetailDto[] = userBadges.map((ub) => ({
      badgeId: ub.badge.id,
      title: ub.badge.title,
      description: ub.badge.description,
      iconUrl: ub.badge.iconUrl,
      locked: !ub.unlocked,
      count: ub.count,
      unlockCondition: ub.badge.unlockCondition,
      unlockedAt: ub.unlockedAt,
    }));

    return { badges };
  }

  // Get a specific user badge

  async getUserBadge(userId: string, badgeId: string, kidId?: string) {
    return this.userBadgeRepository.findByCompositeKey(
      userId,
      kidId ?? null,
      badgeId,
    );
  }

  // Update badge progress

  async updateBadgeProgress(
    userId: string,
    badgeType: string,
    increment: number = 1,
    metadata?: BadgeMetadata,
    kidId?: string,
  ): Promise<void> {
    const relevantBadges =
      this.badgeConstants.BADGE_DEFS_BY_TYPE[badgeType] || [];

    if (relevantBadges.length === 0) {
      return;
    }

    // Batch fetch all badges by title to avoid N+1 queries
    const badgeTitles = relevantBadges.map((b) => b.title);
    const badges = await this.badgeRepository.findManyByTitles(badgeTitles);
    const badgeMap = new Map(badges.map((b) => [b.title, b]));

    for (const badgeDef of relevantBadges) {
      const badge = badgeMap.get(badgeDef.title);

      if (!badge) {
        this.logger.warn(`Badge not found: ${badgeDef.title}`);
        continue;
      }

      // Check for special conditions
      if (this.shouldSkipBadge(badgeDef, metadata)) {
        continue;
      }

      await this.userBadgeRepository.executeTransaction(async (tx) => {
        const compositeKey = {
          userId,
          kidId: typeof kidId === 'undefined' ? null : kidId,
          badgeId: badge.id,
        };
        const userBadge =
          await this.userBadgeRepository.findByCompositeKeyForUpdate(
            compositeKey,
            tx,
          );

        if (!userBadge) {
          this.logger.error(
            `UserBadge not found for user ${userId} and badge ${badge.id}`,
          );
          return;
        }

        // Skip if already unlocked
        if (userBadge.unlocked) {
          return;
        }

        const newCount = userBadge.count + increment;

        // Check if badge should unlock
        const shouldUnlock = newCount >= badge.requiredAmount;

        await this.userBadgeRepository.updateById(
          userBadge.id,
          {
            count: newCount,
            unlocked: shouldUnlock,
            unlockedAt: shouldUnlock ? new Date() : undefined,
          },
          tx,
        );

        if (shouldUnlock) {
          this.logger.log(`User ${userId} unlocked badge: ${badge.title}`);
          // Emit unlock event
          this.eventEmitter.emit('badge.unlocked', {
            userId,
            kidId: kidId ?? null,
            badgeId: badge.id,
            timestamp: new Date(),
          });
        }
      });
    }
  }

  private shouldSkipBadge(
    badgeDef: BadgeDefinition,
    metadata?: BadgeMetadata,
  ): boolean {
    if (badgeDef.badgeType === 'special' && badgeDef.metadata?.timeConstraint) {
      const hour = new Date().getHours();
      const constraint = badgeDef.metadata.timeConstraint;

      if (constraint === 'before_7am' && hour >= 7) {
        return true;
      }
      if (constraint === 'after_9pm' && hour < 21) {
        return true;
      }
    }

    // For quiz badges, check if correctOnly is set
    if (badgeDef.metadata?.correctOnly && metadata?.isCorrect === false) {
      return true;
    }

    return false;
  }

  // Seed initial badge catalog (run once)

  async seedBadges(): Promise<void> {
    const existingCount = await this.badgeRepository.count();
    if (existingCount > 0) {
      this.logger.log('Badges already seeded, skipping...');
      return;
    }

    await this.badgeRepository.createBadgesInTransaction(
      this.badgeConstants.CATALOG,
    );

    this.logger.log(`Seeded ${this.badgeConstants.CATALOG.length} badges`);
  }
}
