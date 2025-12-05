// src/parent-favorites/parent-favorites.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteDto } from './dto/parent-favorite.dto';

@Injectable()
export class ParentFavoritesService {
  constructor(private prisma: PrismaService) {}

  async addFavorite(userId: string, dto: CreateParentFavoriteDto): Promise<ParentFavoriteDto> {
    const favorite = await this.prisma.parentFavorite.create({
      data: {
        userId,
        storyId: dto.storyId,
      },
    });

    return {
      id: favorite.id,
      parentId: favorite.userId,
      storyId: favorite.storyId,
      createdAt: favorite.createdAt,
    };
  }

  async getFavorites(userId: string): Promise<ParentFavoriteDto[]> {
    const favorites = await this.prisma.parentFavorite.findMany({
      where: { userId },
    });

    return favorites.map(fav => ({
      id: fav.id,
      parentId: fav.userId,
      storyId: fav.storyId,
      createdAt: fav.createdAt,
    }));
  }

 async removeFavorite(userId: string, storyId: string): Promise<string> {
  const favorite = await this.prisma.parentFavorite.findFirst({
    where: { userId, storyId },
  });

  if (!favorite) throw new NotFoundException('Favorite not found');

  await this.prisma.parentFavorite.delete({
    where: { id: favorite.id },
  });

  return 'Favorite removed successfully';
}

}
