import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    IStoryFavoriteRepository,
    FavoriteWithStory,
} from './story-favorite.repository.interface';
import { Favorite, Kid, Story } from '@prisma/client';

@Injectable()
export class PrismaStoryFavoriteRepository implements IStoryFavoriteRepository {
    constructor(private readonly prisma: PrismaService) { }

    async createFavorite(kidId: string, storyId: string): Promise<Favorite> {
        return await this.prisma.favorite.create({
            data: {
                kidId,
                storyId,
            },
        });
    }

    async deleteFavorites(
        kidId: string,
        storyId: string,
    ): Promise<{ count: number }> {
        return await this.prisma.favorite.deleteMany({
            where: { kidId, storyId },
        });
    }

    async findFavoritesByKidId(kidId: string): Promise<FavoriteWithStory[]> {
        return await this.prisma.favorite.findMany({
            where: { kidId },
            include: { story: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findKidById(id: string): Promise<Kid | null> {
        return await this.prisma.kid.findUnique({
            where: { id, isDeleted: false },
        });
    }

    async findStoryById(id: string): Promise<Story | null> {
        return await this.prisma.story.findUnique({
            where: { id, isDeleted: false },
        });
    }
}
