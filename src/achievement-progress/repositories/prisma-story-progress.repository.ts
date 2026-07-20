import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IStoryProgressRepository } from './story-progress.repository.interface';

@Injectable()
export class PrismaStoryProgressRepository implements IStoryProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCompletedForKids(kidIds: string[]): Promise<number> {
    return this.prisma.storyProgress.count({
      where: {
        kidId: { in: kidIds },
        completed: true,
        isDeleted: false,
        story: { isDeleted: false },
      },
    });
  }
}
