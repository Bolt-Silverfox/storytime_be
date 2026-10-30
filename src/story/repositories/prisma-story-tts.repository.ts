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

  async findParagraphAudioForVoices(
    storyId: string,
    voiceIds: string[],
    textHashes: string[],
  ): Promise<ParagraphAudioCache[]> {
    return this.prisma.paragraphAudioCache.findMany({
      where: {
        storyId,
        voiceId: { in: voiceIds },
        textHash: { in: textHashes },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findVoiceIdsByElevenLabsId(
    elevenLabsVoiceId: string,
  ): Promise<string[]> {
    const voices = await this.prisma.voice.findMany({
      where: { elevenLabsVoiceId, isDeleted: false },
      select: { id: true },
    });
    return voices.map((v) => v.id);
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
