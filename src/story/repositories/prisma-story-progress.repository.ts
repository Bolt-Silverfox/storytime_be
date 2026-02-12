import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    IStoryProgressRepository,
    StoryProgressWithStory,
    UserStoryProgressWithStory,
} from './story-progress.repository.interface';
import { StoryProgress, UserStoryProgress } from '@prisma/client';

@Injectable()
export class PrismaStoryProgressRepository implements IStoryProgressRepository {
    constructor(private readonly prisma: PrismaService) { }

    async findStoryProgress(
        kidId: string,
        storyId: string,
    ): Promise<StoryProgress | null> {
        return await this.prisma.storyProgress.findUnique({
            where: { kidId_storyId: { kidId, storyId } },
        });
    }

    async upsertStoryProgress(
        kidId: string,
        storyId: string,
        data: {
            progress: number;
            completed: boolean;
            totalTimeSpent?: number;
        },
    ): Promise<StoryProgress> {
        return await this.prisma.storyProgress.upsert({
            where: { kidId_storyId: { kidId, storyId } },
            create: {
                kidId,
                storyId,
                ...data,
            },
            update: {
                ...data,
                lastAccessed: new Date(),
            },
        });
    }

    async findContinueReadingProgress(
        kidId: string,
    ): Promise<StoryProgressWithStory[]> {
        return await this.prisma.storyProgress.findMany({
            where: {
                kidId,
                progress: { gt: 0 },
                completed: false,
                isDeleted: false,
            },
            orderBy: { lastAccessed: 'desc' },
            include: { story: true },
        });
    }

    async findCompletedProgress(
        kidId: string,
    ): Promise<StoryProgressWithStory[]> {
        return await this.prisma.storyProgress.findMany({
            where: { kidId, completed: true, isDeleted: false },
            orderBy: { lastAccessed: 'desc' },
            include: { story: true },
        });
    }

    async deleteStoryProgress(
        kidId: string,
        storyId: string,
    ): Promise<{ count: number }> {
        return await this.prisma.storyProgress.deleteMany({
            where: { kidId, storyId },
        });
    }

    // User Progress Implementation

    async findUserStoryProgress(
        userId: string,
        storyId: string,
    ): Promise<UserStoryProgress | null> {
        return await this.prisma.userStoryProgress.findUnique({
            where: { userId_storyId: { userId, storyId } },
        });
    }

    async upsertUserStoryProgress(
        userId: string,
        storyId: string,
        data: {
            progress: number;
            completed: boolean;
            totalTimeSpent?: number;
        },
    ): Promise<UserStoryProgress> {
        return await this.prisma.userStoryProgress.upsert({
            where: { userId_storyId: { userId, storyId } },
            create: {
                userId,
                storyId,
                ...data,
            },
            update: {
                ...data,
                lastAccessed: new Date(),
            },
        });
    }

    async findUserContinueReadingProgress(
        userId: string,
    ): Promise<UserStoryProgressWithStory[]> {
        return await this.prisma.userStoryProgress.findMany({
            where: {
                userId,
                progress: { gt: 0 },
                completed: false,
                isDeleted: false,
            },
            orderBy: { lastAccessed: 'desc' },
            include: { story: true },
        });
    }

    async findUserCompletedProgress(
        userId: string,
    ): Promise<UserStoryProgressWithStory[]> {
        return await this.prisma.userStoryProgress.findMany({
            where: { userId, completed: true, isDeleted: false },
            orderBy: { lastAccessed: 'desc' },
            include: { story: true },
        });
    }

    async deleteUserStoryProgress(
        userId: string,
        storyId: string,
    ): Promise<{ count: number }> {
        return await this.prisma.userStoryProgress.deleteMany({
            where: { userId, storyId },
        });
    }
}
