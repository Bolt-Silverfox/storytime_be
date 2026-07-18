import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type { IAdminEngagementRepository } from './admin-engagement.repository.interface';

@Injectable()
export class PrismaAdminEngagementRepository
  implements IAdminEngagementRepository
{
  constructor(private readonly prisma: PrismaService) {}

  countKids(where: Prisma.KidWhereInput): Promise<number> {
    return this.prisma.kid.count({ where });
  }

  countStoryProgress(where?: Prisma.StoryProgressWhereInput): Promise<number> {
    return this.prisma.storyProgress.count({ where });
  }

  countFavorites(where?: Prisma.FavoriteWhereInput): Promise<number> {
    return this.prisma.favorite.count({ where });
  }
}
