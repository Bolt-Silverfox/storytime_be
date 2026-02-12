import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IStoryPathRepository } from './story-path.repository.interface';
import { StoryPath } from '@prisma/client';

@Injectable()
export class PrismaStoryPathRepository implements IStoryPathRepository {
    constructor(private readonly prisma: PrismaService) { }

    async createStoryPath(kidId: string, storyId: string): Promise<StoryPath> {
        return await this.prisma.storyPath.create({
            data: {
                kidId,
                storyId,
                path: JSON.stringify([]), // Initial empty path
            },
        });
    }

    async updateStoryPath(
        id: string,
        data: Partial<{ path: string; completedAt: Date | null }>,
    ): Promise<StoryPath> {
        return await this.prisma.storyPath.update({
            where: { id },
            data,
        });
    }

    async findStoryPathById(id: string): Promise<StoryPath | null> {
        return await this.prisma.storyPath.findUnique({ where: { id } });
    }

    async findStoryPathsByKidId(kidId: string): Promise<StoryPath[]> {
        return await this.prisma.storyPath.findMany({
            where: { kidId },
            orderBy: { startedAt: 'desc' },
        });
    }
}
