import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { staleUnverifiedWhere } from './stale-unverified.selection';

@Injectable()
export class PrismaStaleUnverifiedRepository {
  constructor(private readonly prisma: PrismaService) {}

  countEligible(cutoff: Date): Promise<number> {
    return this.prisma.user.count({ where: staleUnverifiedWhere(cutoff) });
  }

  async findEligibleIds(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: staleUnverifiedWhere(cutoff),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  async deleteEligibleByIds(ids: string[], cutoff: Date): Promise<number> {
    const { count } = await this.prisma.user.deleteMany({
      where: { AND: [{ id: { in: ids } }, staleUnverifiedWhere(cutoff)] },
    });
    return count;
  }
}
