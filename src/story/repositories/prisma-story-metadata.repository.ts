import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IStoryMetadataRepository,
  CategoryWithCount,
} from './story-metadata.repository.interface';
import {
  Category,
  Theme,
  StoryImage,
  StoryBranch,
  Season,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PrismaStoryMetadataRepository implements IStoryMetadataRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllCategories(): Promise<CategoryWithCount[]> {
    return await this.prisma.category.findMany({
      include: { _count: { select: { stories: true } } },
    });
  }

  async findCategoriesByIds(ids: string[]): Promise<Category[]> {
    return await this.prisma.category.findMany({
      where: { id: { in: ids } },
    });
  }

  async findAllThemes(): Promise<Theme[]> {
    return await this.prisma.theme.findMany();
  }

  async findThemesByIds(ids: string[]): Promise<Theme[]> {
    return await this.prisma.theme.findMany({
      where: { id: { in: ids } },
    });
  }

  async findAllSeasons(): Promise<Season[]> {
    return await this.prisma.season.findMany();
  }

  async findSeasonsByIds(ids: string[]): Promise<Season[]> {
    return await this.prisma.season.findMany({
      where: { id: { in: ids } },
    });
  }

  async createStoryImage(
    data: Prisma.StoryImageCreateInput,
  ): Promise<StoryImage> {
    return await this.prisma.storyImage.create({ data });
  }

  async createStoryBranch(
    data: Prisma.StoryBranchCreateInput,
  ): Promise<StoryBranch> {
    return await this.prisma.storyBranch.create({ data });
  }

  // Methods requested by Service (mapping to existing)
  async getThemes(): Promise<Theme[]> {
    return this.findAllThemes();
  }

  async getSeasons(): Promise<Season[]> {
    return this.findAllSeasons();
  }

  async getCategories(): Promise<CategoryWithCount[]> {
    return this.findAllCategories();
  }
}
