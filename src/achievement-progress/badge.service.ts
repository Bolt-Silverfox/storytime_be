import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BadgeConstants } from './badge.constants';
import {
    BadgePreviewDto,
    BadgeDetailDto,
    FullBadgeListResponseDto,
} from './dto/badge-response.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BadgeService {
    private readonly logger = new Logger(BadgeService.name);

    constructor(
        private prisma: PrismaService,
        private badgeConstants: BadgeConstants,
        private eventEmitter: EventEmitter2,
    ) { }

    /**
     * Initialize badges for a new user
     */
    async initializeUserBadges(userId: string): Promise<void> {
        const badges = await this.prisma.badge.findMany();
        if (badges.length === 0) {
            this.logger.warn('No badges found in catalog. Run seed first.');
            return;
        }

        // Fetch kids for user and create per-kid and parent-level badge records
        const kids = await this.prisma.kid.findMany({ where: { parentId: userId }, select: { id: true } });

        const txOps = [] as any[];

        for (const badge of badges) {
            // Parent-level (kidId null)
            txOps.push(
                this.prisma.userBadge.create({
                    data: {
                        userId,
                        kidId: null,
                        badgeId: badge.id,
                        count: 0,
                        unlocked: false,
                    },
                }),
            );

            // Per-kid badges
            for (const k of kids) {
                txOps.push(
                    this.prisma.userBadge.create({
                        data: {
                            userId,
                            kidId: k.id,
                            badgeId: badge.id,
                            count: 0,
                            unlocked: false,
                        },
                    }),
                );
            }
        }

        if (txOps.length > 0) {
            await this.prisma.$transaction(txOps);
        }

        this.logger.log(`Initialized ${badges.length} badges for user ${userId} (including per-kid records)`);
    }

    /**
     * Get badge preview (top 3 badges)
     */
    async getBadgePreview(userId: string, kidId?: string): Promise<BadgePreviewDto[]> {
        try {
            const userBadges = await this.prisma.userBadge.findMany({
                where: { userId, kidId: typeof kidId === 'undefined' ? null : kidId },
                include: {
                    badge: true,
                },
                orderBy: [
                    { unlocked: 'desc' }, // Show unlocked first
                    { badge: { priority: 'desc' } }, // Then by priority
                    { badge: { createdAt: 'asc' } }, // Then by creation date
                ],
                take: 3,
            });

            // If less than 3, fill with locked badges
            if (userBadges.length < 3) {
                const remaining = await this.prisma.userBadge.findMany({
                    where: {
                            userId,
                            kidId: typeof kidId === 'undefined' ? null : kidId,
                            unlocked: false,
                            id: { notIn: userBadges.map((ub) => ub.id) },
                        },
                    include: { badge: true },
                    orderBy: [{ badge: { priority: 'desc' } }],
                    take: 3 - userBadges.length,
                });
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
            this.logger.error(`Error fetching badge preview for user ${userId}:`, error);
            return [];
        }
    }


    // Get full badge list with unlock status

    async getFullBadgeList(userId: string, kidId?: string): Promise<FullBadgeListResponseDto> {
        const userBadges = await this.prisma.userBadge.findMany({
            where: { userId, kidId: typeof kidId === 'undefined' ? null : kidId },
            include: {
                badge: true,
            },
            orderBy: [{ badge: { priority: 'desc' } }],
        });

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
        return this.prisma.userBadge.findUnique({
            where: {
                userId_kidId_badgeId: {
                    userId,
                    kidId: typeof kidId === 'undefined' ? null : kidId,
                    badgeId,
                },
            },
            include: { badge: true },
        });
    }

    // Update badge progress

    async updateBadgeProgress(
        userId: string,
        badgeType: string,
        increment: number = 1,
        metadata?: any,
        kidId?: string,
    ): Promise<void> {
        const relevantBadges = this.badgeConstants.BADGE_DEFS_BY_TYPE[badgeType] || [];

        for (const badgeDef of relevantBadges) {
            const badge = await this.prisma.badge.findFirst({
                where: { title: badgeDef.title },
            });

            if (!badge) {
                this.logger.warn(`Badge not found: ${badgeDef.title}`);
                continue;
            }

            // Check for special conditions
            if (this.shouldSkipBadge(badgeDef, metadata)) {
                continue;
            }

            await this.prisma.$transaction(async (tx) => {
                const userBadge = await tx.userBadge.findUnique({
                    where: {
                        userId_kidId_badgeId: {
                            userId,
                            kidId: typeof kidId === 'undefined' ? null : kidId,
                            badgeId: badge.id,
                        },
                    },
                });

                if (!userBadge) {
                    this.logger.error(`UserBadge not found for user ${userId} and badge ${badge.id}`);
                    return;
                }

                // Skip if already unlocked
                if (userBadge.unlocked) {
                    return;
                }

                const newCount = userBadge.count + increment;

                // Check if badge should unlock
                const shouldUnlock = newCount >= badge.requiredAmount;

                await tx.userBadge.update({
                    where: { id: userBadge.id },
                    data: {
                        count: newCount,
                        unlocked: shouldUnlock,
                        unlockedAt: shouldUnlock ? new Date() : undefined,
                    },
                });

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

    private shouldSkipBadge(badgeDef: any, metadata?: any): boolean {
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
        const existingCount = await this.prisma.badge.count();
        if (existingCount > 0) {
            this.logger.log('Badges already seeded, skipping...');
            return;
        }

        await this.prisma.$transaction(
            this.badgeConstants.CATALOG.map((badge) =>
                this.prisma.badge.create({
                    data: {
                        title: badge.title,
                        description: badge.description,
                        iconUrl: badge.iconUrl,
                        unlockCondition: badge.unlockCondition,
                        badgeType: badge.badgeType,
                        requiredAmount: badge.requiredAmount,
                        priority: badge.priority,
                        metadata: badge.metadata,
                    },
                }),
            ),
        );

        this.logger.log(`Seeded ${this.badgeConstants.CATALOG.length} badges`);
    }
}