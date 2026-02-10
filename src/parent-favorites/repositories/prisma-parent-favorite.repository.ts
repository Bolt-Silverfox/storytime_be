import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IParentFavoriteRepository,
  ParentFavoriteWithStory,
} from './parent-favorite.repository.interface';
import type { ParentFavorite } from '@prisma/client';

@Injectable()
export class PrismaParentFavoriteRepository
  implements IParentFavoriteRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async createParentFavorite(
    userId: string,
    storyId: string,
  ): Promise<ParentFavoriteWithStory> {
    return this.prisma.parentFavorite.create({
      data: {
        userId,
        storyId,
      },
      include: {
        story: {
          include: {
            categories: true,
          },
        },
      },
    });
  }

  async findFavoritesByUserId(
    userId: string,
  ): Promise<ParentFavoriteWithStory[]> {
    return this.prisma.parentFavorite.findMany({
      where: { userId },
      include: {
        story: {
          include: {
            categories: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findFavorite(
    userId: string,
    storyId: string,
  ): Promise<ParentFavorite | null> {
    return this.prisma.parentFavorite.findFirst({
      where: { userId, storyId },
    });
  }

  async deleteParentFavorite(id: string): Promise<void> {
    await this.prisma.parentFavorite.delete({
      where: { id },
    });
  }
}
