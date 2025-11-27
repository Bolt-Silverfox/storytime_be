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
      where: { userId: parentId, kidId },
      include: { story: true },
      orderBy: { lastAccessed: 'desc' },
    });

    return {
      history: progress.map((p) => ({
        storyId: p.storyId,
        title: p.story.title,
        coverImage: p.story.coverImageUrl,
        progress: p.progress,
        timeSpent: p.details ? Number(p.details) : 0,
        lastRead: p.lastAccessed,
      })),
    };
  }
}
