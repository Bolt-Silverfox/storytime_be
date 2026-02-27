// src/parent-favorites/parent-favorites.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CursorPaginatedResponse,
  PaginationUtil,
} from '@/shared/utils/pagination.util';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteResponseDto } from './dto/parent-favorite-response.dto';

@Injectable()
export class ParentFavoritesService {
  constructor(private prisma: PrismaService) {}

  async addFavorite(
    userId: string,
    dto: CreateParentFavoriteDto,
  ): Promise<ParentFavoriteResponseDto> {
    const favorite = await this.prisma.parentFavorite.create({
      data: {
        userId,
        storyId: dto.storyId,
      },
      include: {
        story: {
          include: {
            categories: true,
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
      categories: favorite.story.categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        image: cat.image ?? undefined,
        description: cat.description ?? undefined,
      })),
      ageRange: `${favorite.story.ageMin}-${favorite.story.ageMax}`,
      durationSeconds: favorite.story.durationSeconds ?? undefined,
      createdAt: favorite.createdAt,
    };
  }

  async getFavorites(
    userId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPaginatedResponse<ParentFavoriteResponseDto>> {
    const pageSize = limit ?? 20;

    const favorites = await this.prisma.parentFavorite.findMany({
      where: { userId },
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        story: {
          include: {
            categories: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    const mapped = favorites.map((fav) => ({
      id: fav.id,
      storyId: fav.storyId,
      title: fav.story.title,
      description: fav.story.description,
      coverImageUrl: fav.story.coverImageUrl,
      categories: fav.story.categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        image: cat.image ?? undefined,
        description: cat.description ?? undefined,
      })),
      ageRange: `${fav.story.ageMin}-${fav.story.ageMax}`,
      durationSeconds: fav.story.durationSeconds ?? undefined,
      createdAt: fav.createdAt,
    }));

    return PaginationUtil.buildCursorResponse(mapped, pageSize);
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
