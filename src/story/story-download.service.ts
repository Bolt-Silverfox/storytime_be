import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
    IStoryDownloadRepository,
    STORY_DOWNLOAD_REPOSITORY,
} from './repositories/story-download.repository.interface';
import { Story } from '@prisma/client';

@Injectable()
export class StoryDownloadService {
    constructor(
        @Inject(STORY_DOWNLOAD_REPOSITORY)
        private readonly downloadRepository: IStoryDownloadRepository,
    ) { }

    async getDownloads(kidId: string): Promise<Story[]> {
        const downloads = await this.downloadRepository.findDownloadsByKidId(kidId);
        return downloads.map((d) => d.story);
    }

    async addDownload(kidId: string, storyId: string) {
        const story = await this.downloadRepository.findStoryById(storyId);
        if (!story) throw new NotFoundException('Story not found');

        return await this.downloadRepository.upsertDownload(kidId, storyId);
    }

    async removeDownload(kidId: string, storyId: string) {
        const result = await this.downloadRepository.deleteDownload(kidId, storyId);
        return result || { message: 'Download removed' };
    }

    // Helper for cleanup (called by StoryService.removeFromLibrary)
    async deleteDownloadsForStory(kidId: string, storyId: string) {
        return await this.downloadRepository.deleteDownloads(kidId, storyId);
    }
}
