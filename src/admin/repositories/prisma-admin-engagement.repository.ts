import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type { IAdminEngagementRepository } from './admin-engagement.repository.interface';

@Injectable()
export class PrismaAdminEngagementRepository implements IAdminEngagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  countKids(where: Prisma.KidWhereInput): Promise<number> {
    return this.prisma.kid.count({ where });
  }

  countStoryProgress(where?: Prisma.StoryProgressWhereInput): Promise<number> {
    return this.prisma.storyProgress.count({ where });
  }

  countFavorites(where?: Prisma.FavoriteWhereInput): Promise<number> {
    return this.prisma.favorite.count({ where });
  }

  async getAverageSessionSeconds(start: Date, end: Date): Promise<number> {
    const rows = await this.prisma.session.findMany({
      where: {
        isDeleted: false,
        lastActivityAt: { not: null, gte: start, lte: end },
      },
      select: { createdAt: true, lastActivityAt: true },
    });
    if (rows.length === 0) return 0;
    const totalSeconds = rows.reduce((sum, r) => {
      const lastActivity = r.lastActivityAt as Date;
      return sum + (lastActivity.getTime() - r.createdAt.getTime()) / 1000;
    }, 0);
    return totalSeconds / rows.length;
  }
}
