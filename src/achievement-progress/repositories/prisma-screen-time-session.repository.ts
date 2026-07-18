import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IScreenTimeSessionRepository,
  DurationSumResult,
} from './screen-time-session.repository.interface';

@Injectable()
export class PrismaScreenTimeSessionRepository
  implements IScreenTimeSessionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async sumDurationForKids(kidIds: string[]): Promise<DurationSumResult> {
    return this.prisma.screenTimeSession.aggregate({
      where: {
        kidId: { in: kidIds },
        endTime: { not: null },
      },
      _sum: {
        duration: true,
      },
    });
  }
}
