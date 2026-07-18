import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IBadgeRepository } from './badge.repository.interface';
import type { BadgeDefinition } from '../badge.constants';
import type { Badge } from '@prisma/client';

@Injectable()
export class PrismaBadgeRepository implements IBadgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Badge[]> {
    return this.prisma.badge.findMany();
  }

  async findManyByTitles(titles: string[]): Promise<Badge[]> {
    return this.prisma.badge.findMany({
      where: { title: { in: titles } },
    });
  }

  async count(): Promise<number> {
    return this.prisma.badge.count();
  }

  async createBadgesInTransaction(
    catalog: BadgeDefinition[],
  ): Promise<Badge[]> {
    return this.prisma.$transaction(
      catalog.map((badge) =>
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
  }
}
