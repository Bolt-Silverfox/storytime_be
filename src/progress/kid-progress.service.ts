import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KidProgressService {
  constructor(private prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  private async resolveKidAge(kid: any): Promise<number | undefined> {
    if (!kid || !kid.ageRange) return undefined;

    // Attempt direct numeric age (e.g., "3")
    const num = parseInt(kid.ageRange, 10);
    if (!isNaN(num)) return num;

    // Fall back to AgeGroup lookup
    const ageGroup =
      (await this.prisma.ageGroup.findUnique({
        where: { name: kid.ageRange },
      })) ||
      (await this.prisma.ageGroup.findFirst({
        where: { name: { contains: kid.ageRange, mode: 'insensitive' } },
      }));

    if (ageGroup) return Math.floor((ageGroup.min + ageGroup.max) / 2);

    return undefined;
  }

  async listProgress(kidId: string, parentId: string) {
    const kid = await this.assertOwnership(kidId, parentId);
    const kidAge = await this.resolveKidAge(kid);

    const where: any = { kidId };

    if (kidAge !== undefined) {
      where.story = {
        ageMin: { lte: kidAge },
        ageMax: { gte: kidAge },
      };
    }

    const items = await this.prisma.storyProgress.findMany({
      where,
      include: { story: true },
      orderBy: { lastAccessed: 'desc' },
    });

    const mapped = items.map((p) => ({
      storyId: p.storyId,
      progress: p.progress,
      completed: p.completed,
      lastAccessed: p.lastAccessed,
      story: p.story,
    }));

    return {
      items: mapped,
      total: mapped.length,
    };
  }
}
