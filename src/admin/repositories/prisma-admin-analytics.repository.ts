import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { IAdminAnalyticsRepository } from './admin-analytics.repository.interface';

@Injectable()
export class PrismaAdminAnalyticsRepository implements IAdminAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async pingDatabase(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async countUniqueGuestStories(
    guestStoryAccessedAction: string,
  ): Promise<number> {
    const uniqueStoriesResult = await this.prisma.$queryRaw<
      [{ count: bigint }]
    >`
      SELECT COUNT(DISTINCT details::jsonb->>'storyId') as count
      FROM "activity_logs"
      WHERE action = ${guestStoryAccessedAction} AND "isDeleted" = false
      AND details IS NOT NULL AND details LIKE '{%'
    `;
    return Number(uniqueStoriesResult[0]?.count ?? 0);
  }
}
