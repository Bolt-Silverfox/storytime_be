import { Injectable, Inject } from '@nestjs/common';
import {
    CategoryDto,
    ThemeDto,
    StoryImageDto,
    StoryBranchDto,
} from './dto/story.dto';
import {
    IStoryMetadataRepository,
    STORY_METADATA_REPOSITORY,
} from './repositories/story-metadata.repository.interface';

@Injectable()
export class StoryMetadataService {
    constructor(
        @Inject(STORY_METADATA_REPOSITORY)
        private readonly metadataRepository: IStoryMetadataRepository,
    ) { }

    async getCategories(): Promise<CategoryDto[]> {
        const categories = await this.metadataRepository.findAllCategories();
        return categories.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description || undefined,
            image: c.image || undefined,
            storyCount: c._count.stories,
        }));
    }

    async getThemes(): Promise<ThemeDto[]> {
        const themes = await this.metadataRepository.findAllThemes();
        return themes.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description || undefined,
            content: t.description || undefined, // Map to DTO requirements
        }));
    }

    async getSeasons() {
        // Return type inferred or map to DTO if SeasonDto exists
        return await this.metadataRepository.findAllSeasons();
    }

    async addImage(storyId: string, dto: StoryImageDto) {
        return await this.metadataRepository.createStoryImage({
            ...dto,
            story: { connect: { id: storyId } },
        });
    }

    async addBranch(storyId: string, branch: StoryBranchDto) {
        return await this.metadataRepository.createStoryBranch({
            id: undefined, // Let DB generate
            ...branch,
            story: { connect: { id: storyId } },
        });
    }
}
