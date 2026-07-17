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

  private toStoryPathDto(path: StoryPath): StoryPathDto {
    return {
      id: path.id,
      kidId: path.kidId,
      storyId: path.storyId,
      path: path.path,
      startedAt: path.startedAt,
      completedAt: path.completedAt ?? undefined,
    };
  }

  async startStoryPath(dto: StartStoryPathDto): Promise<StoryPathDto> {
    const kid = await this.pathRepository.findKidById(dto.kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.pathRepository.findStoryById(dto.storyId);
    if (!story) throw new NotFoundException('Story not found');

    const storyPath = await this.pathRepository.createStoryPath(
      dto.kidId,
      dto.storyId,
    );
    return this.toStoryPathDto(storyPath);
  }

  async updateStoryPath(dto: UpdateStoryPathDto): Promise<StoryPathDto> {
    const storyPath = await this.pathRepository.updateStoryPath(dto.pathId, {
      path: dto.path,
      completedAt: dto.completedAt,
    });
    return this.toStoryPathDto(storyPath);
  }

  async getStoryPathsForKid(kidId: string): Promise<StoryPathDto[]> {
    const kid = await this.pathRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    const paths = await this.pathRepository.findStoryPathsByKidId(kidId);
    return paths.map((p: StoryPath) => this.toStoryPathDto(p));
  }

  async getStoryPathById(id: string): Promise<StoryPathDto | null> {
    const path = await this.pathRepository.findStoryPathById(id);
    return path ? this.toStoryPathDto(path) : null;
  }
}
