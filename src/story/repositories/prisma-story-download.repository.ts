import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IStoryDownloadRepository,
  DownloadedStoryWithStory,
} from './story-download.repository.interface';
import { DownloadedStory, Story } from '@prisma/client';

@Injectable()
export class PrismaStoryDownloadRepository implements IStoryDownloadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertDownload(
    kidId: string,
    storyId: string,
  ): Promise<DownloadedStory> {
    return await this.prisma.downloadedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: { kidId, storyId },
      update: { downloadedAt: new Date() },
    });
  }

  async deleteDownload(
    kidId: string,
    storyId: string,
  ): Promise<DownloadedStory | null> {
    try {
      return await this.prisma.downloadedStory.delete({
        where: { kidId_storyId: { kidId, storyId } },
      });
    } catch {
      return null;
    }
  }

  async deleteDownloads(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return await this.prisma.downloadedStory.deleteMany({
      where: { kidId, storyId },
    });
  }

  async findDownloadsByKidId(
    kidId: string,
  ): Promise<DownloadedStoryWithStory[]> {
    return await this.prisma.downloadedStory.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { downloadedAt: 'desc' },
    });
  }

  async findStoryById(id: string): Promise<Story | null> {
    return await this.prisma.story.findUnique({
      where: { id, isDeleted: false },
    });
  }
}
