import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KidAchievementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  private async resolveKidAge(kid: any): Promise<number | undefined> {
    if (!kid?.ageRange) return;

    const num = Number(kid.ageRange);
    if (!isNaN(num)) return num;

    const group =
      (await this.prisma.ageGroup.findUnique({ where: { name: kid.ageRange } })) ||
      (await this.prisma.ageGroup.findFirst({
        where: { name: { contains: kid.ageRange, mode: 'insensitive' } },
      }));

    if (group) return Math.floor((group.min + group.max) / 2);
  }

  async listAchievements(kidId: string, parentId: string) {
    const kid = await this.assertOwnership(kidId, parentId);
    const kidAge = await this.resolveKidAge(kid);

    // Achievements = reward redemptions (existing model)
    const redemptions = await this.prisma.rewardRedemption.findMany({
      where: { kidId },
      include: { reward: true },
      orderBy: { redeemedAt: 'desc' },
    });

    // If rewards gain age metadata later, filter here.
    const badges = redemptions.map((r) => ({
      id: r.id,
      title: r.reward?.name ?? 'Achievement',
      description: r.reward?.description ?? '',
      unlockedAt: r.redeemedAt,
    }));

    return { badges, total: badges.length };
  }
}
