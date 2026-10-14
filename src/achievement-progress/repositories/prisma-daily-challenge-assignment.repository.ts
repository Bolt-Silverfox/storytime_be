import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IDailyChallengeAssignmentRepository } from './daily-challenge-assignment.repository.interface';
import type { DailyChallengeAssignment } from '@prisma/client';

@Injectable()
export class PrismaDailyChallengeAssignmentRepository implements IDailyChallengeAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCompletedForKids(kidIds: string[]): Promise<number> {
    return this.prisma.dailyChallengeAssignment.count({
      where: {
        kidId: { in: kidIds },
        completed: true,
      },
    });
  }

  async markCompleted(
    kidId: string,
    challengeId: string,
  ): Promise<{ count: number }> {
    // Use updateMany since there's no unique constraint
    return this.prisma.dailyChallengeAssignment.updateMany({
      where: { kidId, challengeId },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });
  }

  async findFirstByKidAndChallenge(
    kidId: string,
    challengeId: string,
  ): Promise<DailyChallengeAssignment | null> {
    return this.prisma.dailyChallengeAssignment.findFirst({
      where: { kidId, challengeId },
    });
  }
}
