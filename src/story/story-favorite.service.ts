import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { FavoriteDto } from './dto/story.dto';
import { Favorite } from '@prisma/client';
import {
    IStoryFavoriteRepository,
    STORY_FAVORITE_REPOSITORY,
    FavoriteWithStory,
} from './repositories/story-favorite.repository.interface';

@Injectable()
export class StoryFavoriteService {
    constructor(
        @Inject(STORY_FAVORITE_REPOSITORY)
        private readonly favoriteRepository: IStoryFavoriteRepository,
    ) { }

    /**
     * Add a story to a kid's favorites
     * @param dto - Contains kidId and storyId
     * @returns The created favorite record
     * @throws NotFoundException if kid or story not found
     */
    async addFavorite(dto: FavoriteDto): Promise<Favorite> {
        // Batch validation queries
        const [kid, story] = await Promise.all([
            this.favoriteRepository.findKidById(dto.kidId),
            this.favoriteRepository.findStoryById(dto.storyId),
        ]);

        if (!kid) throw new NotFoundException('Kid not found');
        if (!story) throw new NotFoundException('Story not found');

        return await this.favoriteRepository.createFavorite(dto.kidId, dto.storyId);
    }

    /**
     * Remove a story from a kid's favorites
     * @param kidId - The kid's ID
     * @param storyId - The story's ID
     * @returns The number of deleted records
     */
    async removeFavorite(
        kidId: string,
        storyId: string,
    ): Promise<{ count: number }> {
        return await this.favoriteRepository.deleteFavorites(kidId, storyId);
    }

    /**
     * Get all favorite stories for a kid
     * @param kidId - The kid's ID
     * @returns Array of favorites with story details
     * @throws NotFoundException if kid not found
     */
    async getFavorites(kidId: string): Promise<FavoriteWithStory[]> {
        const kid = await this.favoriteRepository.findKidById(kidId);
        if (!kid) throw new NotFoundException('Kid not found');

        return await this.favoriteRepository.findFavoritesByKidId(kidId);
    }
}
