import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IStoryRecommendationRepository } from './story-recommendation.repository.interface';
import { ParentRecommendation } from '@prisma/client';
import { ParentRecommendationWithRelations } from './story.repository.interface';

@Injectable()
export class PrismaStoryRecommendationRepository
  implements IStoryRecommendationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findParentRecommendation(
    userId: string,
    kidId: string,
    storyId: string,
  ): Promise<ParentRecommendation | null> {
    return this.prisma.parentRecommendation.findFirst({
      where: {
        userId,
        kidId,
        storyId,
        isDeleted: false,
      },
    });
  }

  async findParentRecommendationById(
    id: string,
  ): Promise<ParentRecommendation | null> {
    return this.prisma.parentRecommendation.findUnique({
      where: { id },
    });
  }

  async createParentRecommendation(
    userId: string,
    kidId: string,
    storyId: string,
    message?: string,
  ): Promise<ParentRecommendationWithRelations> {
    return this.prisma.parentRecommendation.create({
      data: {
        userId,
        kidId,
        storyId,
        message,
      },
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
    });
  }

  async updateParentRecommendation(
    id: string,
    data: Partial<{
      isDeleted: boolean;
      deletedAt: Date | null;
      message: string | null;
    }>,
  ): Promise<ParentRecommendationWithRelations> {
    return this.prisma.parentRecommendation.update({
      where: { id },
      data,
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
    });
  }

  async deleteParentRecommendation(id: string): Promise<ParentRecommendation> {
    return this.prisma.parentRecommendation.delete({
      where: { id },
    });
  }

  async findParentRecommendationsByKidId(
    kidId: string,
  ): Promise<ParentRecommendationWithRelations[]> {
    return this.prisma.parentRecommendation.findMany({
      where: {
        kidId,
        isDeleted: false,
      },
      include: {
        story: true,
        user: { select: { id: true, name: true, email: true } },
        kid: { select: { id: true, name: true } },
      },
      orderBy: { recommendedAt: 'desc' },
    });
  }

  async countParentRecommendationsByKidId(kidId: string): Promise<number> {
    return this.prisma.parentRecommendation.count({
      where: {
        kidId,
        isDeleted: false,
      },
    });
  }

  async groupParentRecommendationsByStory(
    limit: number,
  ): Promise<Array<{ storyId: string; _count: { storyId: number } }>> {
    // Group by storyId and count, ordered by count desc
    const results = await this.prisma.parentRecommendation.groupBy({
      by: ['storyId'],
      _count: {
        storyId: true,
      },
      where: {
        isDeleted: false,
      },
      orderBy: {
        _count: {
          storyId: 'desc',
        },
      },
      take: limit,
    });

    return results as unknown as Array<{
      storyId: string;
      _count: { storyId: number };
    }>;
  }
}
