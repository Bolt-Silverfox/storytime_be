import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { ParagraphAudioCache, Voice } from '@prisma/client';
import type { IStoryTtsRepository } from './story-tts.repository.interface';

@Injectable()
export class PrismaStoryTtsRepository implements IStoryTtsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCachedParagraphAudio(
    storyId: string,
    textHash: string,
    voiceId: string,
    provider?: string,
  ): Promise<ParagraphAudioCache | null> {
    return this.prisma.paragraphAudioCache.findFirst({
      where: { storyId, textHash, voiceId, ...(provider ? { provider } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertParagraphAudio(
    storyId: string,
    textHash: string,
    voiceId: string,
    audioUrl: string,
    provider: string,
  ): Promise<ParagraphAudioCache> {
    return this.prisma.paragraphAudioCache.upsert({
      where: {
        storyId_textHash_voiceId_provider: {
          storyId,
          textHash,
          voiceId,
          provider,
        },
      },
      create: { storyId, textHash, voiceId, audioUrl, provider },
      update: { audioUrl },
    });
  }

  async findParagraphAudioForProvider(
    storyId: string,
    voiceId: string,
    provider: string,
    textHashes: string[],
  ): Promise<ParagraphAudioCache[]> {
    return this.prisma.paragraphAudioCache.findMany({
      where: {
        storyId,
        voiceId,
        provider,
        textHash: { in: textHashes },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findVoiceByIdOrName(type: string): Promise<Voice | null> {
    return this.prisma.voice.findFirst({
      where: {
        OR: [{ id: type }, { name: type }],
        isDeleted: false,
      },
    });
  }
}
