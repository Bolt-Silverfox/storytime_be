import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import {
  CategoryDto,
  ThemeDto,
  StoryImageDto,
  StoryBranchDto,
} from './dto/story.dto';
import { Theme } from '@prisma/client';
import {
  IStoryMetadataRepository,
  STORY_METADATA_REPOSITORY,
} from './repositories/story-metadata.repository.interface';

@Injectable()
export class StoryMetadataService {
  private readonly logger = new Logger(StoryMetadataService.name);

  constructor(
    @Inject(STORY_METADATA_REPOSITORY)
    private readonly metadataRepository: IStoryMetadataRepository,
  ) {}

  async getCategories(): Promise<CategoryDto[]> {
    this.logger.log('Fetching categories with story counts from database');
    const categories = await this.metadataRepository.findAllCategories();
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image ?? undefined,
      description: c.description ?? undefined,
      storyCount: c._count.stories,
    }));
  }

  async getThemes(): Promise<ThemeDto[]> {
    const themes = await this.metadataRepository.findAllThemes();
    return themes.map((t: Theme) => ({
      ...t,
      image: t.image ?? undefined,
      description: t.description ?? undefined,
    }));
  }

  async getSeasons() {
    return await this.metadataRepository.getSeasons();
  }

  async addImage(storyId: string, image: StoryImageDto) {
    const story = await this.metadataRepository.findStoryById(storyId);
    if (!story) throw new NotFoundException('Story not found');
    return await this.metadataRepository.createStoryImage({
      ...image,
      story: { connect: { id: storyId } },
    });
  }

  async addBranch(storyId: string, branch: StoryBranchDto) {
    const story = await this.metadataRepository.findStoryById(storyId);
    if (!story) throw new NotFoundException('Story not found');
    return await this.metadataRepository.createStoryBranch({
      ...branch,
      story: { connect: { id: storyId } },
    });
  }
}
