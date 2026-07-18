import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import type { IUserCleanupRepository } from './user-cleanup.repository.interface';

@Injectable()
export class PrismaUserCleanupRepository implements IUserCleanupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async softDeleteUserSessions(userId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.session.updateMany({
      where: { userId, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async cancelActiveUserSubscriptions(
    userId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.subscription.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'cancelled', endsAt: new Date() },
    });
  }
}
