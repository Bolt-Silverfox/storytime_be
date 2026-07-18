import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IFavoriteRepository } from './favorite.repository.interface';

@Injectable()
export class PrismaFavoriteRepository implements IFavoriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countByKid(kidId: string): Promise<number> {
    return this.prisma.favorite.count({
      where: { kidId },
    });
  }
}
