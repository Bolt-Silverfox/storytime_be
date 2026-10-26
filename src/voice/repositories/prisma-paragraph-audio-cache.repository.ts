import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IParagraphAudioCacheRepository } from './paragraph-audio-cache.repository.interface';

@Injectable()
export class PrismaParagraphAudioCacheRepository implements IParagraphAudioCacheRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDistinctVoiceIdsForStory(
    storyId: string,
  ): Promise<Array<{ voiceId: string }>> {
    return this.prisma
      .$queryRaw`SELECT DISTINCT "voiceId" FROM "paragraph_audio_cache" WHERE "storyId" = ${storyId}`;
  }
}
