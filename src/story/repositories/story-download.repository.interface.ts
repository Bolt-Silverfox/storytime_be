import { DownloadedStory } from '@prisma/client';
import { Story } from '@prisma/client';

export type DownloadedStoryWithStory = DownloadedStory & {
  story: Story;
};

export interface IStoryDownloadRepository {
  upsertDownload(kidId: string, storyId: string): Promise<DownloadedStory>;

  deleteDownload(
    kidId: string,
    storyId: string,
  ): Promise<DownloadedStory | null>;

  deleteDownloads(kidId: string, storyId: string): Promise<{ count: number }>;

  findDownloadsByKidId(kidId: string): Promise<DownloadedStoryWithStory[]>;

  findStoryById(id: string): Promise<Story | null>;
}

export const STORY_DOWNLOAD_REPOSITORY = Symbol('STORY_DOWNLOAD_REPOSITORY');
