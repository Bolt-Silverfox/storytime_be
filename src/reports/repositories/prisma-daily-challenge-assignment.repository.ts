import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IDailyChallengeAssignmentRepository } from './daily-challenge-assignment.repository.interface';

@Injectable()
export class PrismaDailyChallengeAssignmentRepository implements IDailyChallengeAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCompletedInRange(
    kidId: string,
    gte: Date,
    lt: Date,
  ): Promise<number> {
    return this.prisma.dailyChallengeAssignment.count({
      where: {
        kidId,
        completed: true,
        completedAt: {
          gte,
          lt,
        },
      },
    });
  }

  async countCompletedSince(kidId: string, gte: Date): Promise<number> {
    return this.prisma.dailyChallengeAssignment.count({
      where: {
        kidId,
        completed: true,
        completedAt: { gte },
      },
    });
  }
}
