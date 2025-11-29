import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KidHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  async getKidHistory(kidId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    const progress = await this.prisma.storyProgress.findMany({
      where: { kidId },
      orderBy: { lastAccessed: 'desc' },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            coverImageUrl: true,
          },
        },
      },
    });

    return {
      history: progress.map((p) => ({
        storyId: p.storyId,
        title: p.story?.title ?? null,
        coverImage: p.story?.coverImageUrl ?? null,
        progress: p.progress,
        timeSpent: p.totalTimeSpent ?? 0,
        lastRead: p.lastAccessed,
      })),
    };
  }

  /**
   * Delete a single history entry (story progress)
   */
  async deleteSingle(kidId: string, storyId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    await this.prisma.storyProgress.deleteMany({
      where: { kidId, storyId },
    });

    return { success: true };
  }

  /**
   * Clear all reading history for a kid
   */
  async clearAll(kidId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    await this.prisma.storyProgress.deleteMany({
      where: { kidId },
    });

    return { success: true };
  }
}
