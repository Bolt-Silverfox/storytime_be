// src/parent-favorites/parent-favorites.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteDto } from './dto/parent-favorite.dto';

@Injectable()
export class ParentFavoritesService {
  constructor(private prisma: PrismaService) { }

  async addFavorite(userId: string, dto: CreateParentFavoriteDto): Promise<ParentFavoriteDto> {
    const favorite = await this.prisma.parentFavorite.create({
      data: {
        userId,
        storyId: dto.storyId,
      },
      include: {
        story: {
          include: {
            images: true,
            branches: true,
            themes: true,
            categories: true,
          },
        },
      },
    });

    return {
      id: favorite.id,
      parentId: favorite.userId,
      storyId: favorite.storyId,
      story: {
        ...favorite.story,
        durationSeconds: favorite.story.durationSeconds ?? undefined,
        textContent: favorite.story.textContent ?? undefined,
        images: favorite.story.images.map((image) => ({
          ...image,
          caption: image.caption ?? undefined,
        })),
        branches: favorite.story.branches.map((branch) => ({
          ...branch,
          nextA: branch.nextA ?? undefined,
          nextB: branch.nextB ?? undefined,
        })),
        themeIds: favorite.story.themes.map((t) => t.id),
        categoryIds: favorite.story.categories.map((c) => c.id),
      },
      createdAt: favorite.createdAt,
    };
  }

  async getFavorites(userId: string): Promise<ParentFavoriteDto[]> {
    const favorites = await this.prisma.parentFavorite.findMany({
      where: { userId },
      include: {
        story: {
          include: {
            images: true,
            branches: true,
            themes: true,
            categories: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((fav) => ({
      id: fav.id,
      parentId: fav.userId,
      storyId: fav.storyId,
      story: {
        ...fav.story,
        durationSeconds: fav.story.durationSeconds ?? undefined,
        textContent: fav.story.textContent ?? undefined,
        images: fav.story.images.map((image) => ({
          ...image,
          caption: image.caption ?? undefined,
        })),
        branches: fav.story.branches.map((branch) => ({
          ...branch,
          nextA: branch.nextA ?? undefined,
          nextB: branch.nextB ?? undefined,
        })),
        themeIds: fav.story.themes.map((t) => t.id),
        categoryIds: fav.story.categories.map((c) => c.id),
      },
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
