// src/parent-favorites/parent-favorites.service.ts
import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteResponseDto } from './dto/parent-favorite-response.dto';
import {
  IParentFavoriteRepository,
  PARENT_FAVORITE_REPOSITORY,
} from './repositories';

@Injectable()
export class ParentFavoritesService {
  constructor(
    @Inject(PARENT_FAVORITE_REPOSITORY)
    private readonly parentFavoriteRepository: IParentFavoriteRepository,
  ) {}

  async addFavorite(
    userId: string,
    dto: CreateParentFavoriteDto,
  ): Promise<ParentFavoriteResponseDto> {
    const favorite =
      await this.parentFavoriteRepository.createParentFavorite(
        userId,
        dto.storyId,
      );

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

  async getFavorites(userId: string): Promise<ParentFavoriteResponseDto[]> {
    const favorites =
      await this.parentFavoriteRepository.findFavoritesByUserId(userId);

    return favorites.map((fav) => ({
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
  }

  async removeFavorite(userId: string, storyId: string): Promise<string> {
    const favorite = await this.parentFavoriteRepository.findFavorite(
      userId,
      storyId,
    );

    if (!favorite) throw new NotFoundException('Favorite not found');

    await this.parentFavoriteRepository.deleteParentFavorite(favorite.id);

    return 'Favorite removed successfully';
  }
}
