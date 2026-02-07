// src/parent-favorites/parent-favorites.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteResponseDto } from './dto/parent-favorite-response.dto';

@Injectable()
export class ParentFavoritesService {
  constructor(private prisma: PrismaService) { }

  async addFavorite(userId: string, dto: CreateParentFavoriteDto): Promise<ParentFavoriteResponseDto> {
    const favorite = await this.prisma.parentFavorite.create({
      data: {
        userId,
        storyId: dto.storyId,
      },
      include: {
        story: {
          include: {
            creatorKid: true,
          },
        },
      },
    });

    return {
      id: favorite.id,
      storyId: favorite.storyId,
      title: favorite.story.title,
      description: favorite.story.description,
      coverImageUrl: favorite.story.coverImageUrl,
      author: favorite.story.creatorKid?.name ?? undefined,
      ageRange: `${favorite.story.ageMin}-${favorite.story.ageMax}`,
      createdAt: favorite.createdAt,
    };
  }

  async getFavorites(userId: string): Promise<ParentFavoriteResponseDto[]> {
    const favorites = await this.prisma.parentFavorite.findMany({
      where: { userId },
      include: {
        story: {
          include: {
            images: true,
            branches: true,
            themes: true,
            categories: true,
            creatorKid: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((fav) => ({
      id: fav.id,
      storyId: fav.storyId,
      title: fav.story.title,
      description: fav.story.description,
      coverImageUrl: fav.story.coverImageUrl,
      author: fav.story.creatorKid?.name ?? undefined,
      ageRange: `${fav.story.ageMin}-${fav.story.ageMax}`,
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
