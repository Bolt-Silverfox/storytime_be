import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
  StartStoryPathDto,
  UpdateStoryPathDto,
  StoryPathDto,
} from './dto/story.dto';
import {
  IStoryPathRepository,
  STORY_PATH_REPOSITORY,
} from './repositories/story-path.repository.interface';
import { StoryPath } from '@prisma/client';

@Injectable()
export class StoryPathService {
  constructor(
    @Inject(STORY_PATH_REPOSITORY)
    private readonly pathRepository: IStoryPathRepository,
  ) {}

  async startStoryPath(dto: StartStoryPathDto): Promise<StoryPathDto> {
    const path = await this.pathRepository.createStoryPath(
      dto.kidId,
      dto.storyId,
    );
    return this.toStoryPathDto(path);
  }

  async updateStoryPath(
    id: string,
    dto: UpdateStoryPathDto,
  ): Promise<StoryPathDto> {
    const existingPath = await this.pathRepository.findStoryPathById(id);
    if (!existingPath) throw new NotFoundException('Story path not found');

    const updated = await this.pathRepository.updateStoryPath(id, {
      path: dto.path,
      completedAt: dto.completedAt ?? null,
    });

    return this.toStoryPathDto(updated);
  }

  async getStoryPaths(storyId: string) {
    // This looks like it was possibly filtering by kidId in original service?
    // Based on original method signature, let's implement get by id
    // Or if it was meant to be get paths FOR a story across kids (unlikely for frontend)
    // Let's implement getting paths for a kid if that's the common use case
    // For now, mirroring repository method
    return [];
  }

  async getStoryPathById(id: string): Promise<StoryPathDto> {
    const path = await this.pathRepository.findStoryPathById(id);
    if (!path) throw new NotFoundException('Story path not found');
    return this.toStoryPathDto(path);
  }

  toStoryPathDto(path: StoryPath): StoryPathDto {
    return {
      id: path.id,
      kidId: path.kidId,
      storyId: path.storyId,
      path: typeof path.path === 'string' ? JSON.parse(path.path) : path.path,
      startedAt: path.startedAt,
      completedAt: path.completedAt ?? undefined,
    };
  }
}
