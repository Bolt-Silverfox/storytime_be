import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as dayjs from 'dayjs';

@Injectable()
export class KidStreakService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  private async resolveKidAge(kid: any): Promise<number | undefined> {
    if (!kid?.ageRange) return;
    const numeric = Number(kid.ageRange);
    if (!isNaN(numeric)) return numeric;

    const group =
      (await this.prisma.ageGroup.findUnique({ where: { name: kid.ageRange } })) ||
      (await this.prisma.ageGroup.findFirst({
        where: { name: { contains: kid.ageRange, mode: 'insensitive' } },
      }));

    if (group) return Math.floor((group.min + group.max) / 2);
  }

  async getCurrentStreak(kidId: string, parentId: string) {
    const kid = await this.assertOwnership(kidId, parentId);
    const kidAge = await this.resolveKidAge(kid);

    const where: any = { kidId };
    if (kidAge !== undefined) {
      where.story = {
        ageMin: { lte: kidAge },
        ageMax: { gte: kidAge },
      };
    }

    const paths = await this.prisma.storyPath.findMany({
      where,
      select: { startedAt: true, completedAt: true },
    });

    const dates = new Set<string>();
    for (const p of paths) {
      const d = p.completedAt ?? p.startedAt;
      if (d) dates.add(dayjs(d).format('YYYY-MM-DD'));
    }

    if (dates.size === 0) return { currentStreak: 0, longestStreak: 0 };

    // Compute current streak
    let current = 0;
    let pointer = dayjs();
    while (dates.has(pointer.format('YYYY-MM-DD'))) {
      current++;
      pointer = pointer.subtract(1, 'day');
    }

    // Compute longest streak
    const sorted = Array.from(dates).sort(); // yyyy-mm-dd ascending
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = dayjs(sorted[i - 1]);
      const cur = dayjs(sorted[i]);
      if (cur.diff(prev, 'day') === 1) {
        run++;
      } else {
        longest = Math.max(longest, run);
        run = 1;
      }
    }
    longest = Math.max(longest, run);

    return { currentStreak: current, longestStreak: longest };
  }
}

