import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { preprocessTextForTTS } from './tts-text.util';

/**
 * Owns the paragraph-audio cache: content-addressed hashing plus read/write
 * against `paragraphAudioCache`. Cache keys are `hashText`-derived so they
 * must stay stable byte-for-byte.
 */
@Injectable()
export class TtsCacheService {
  constructor(private readonly prisma: PrismaService) {}

  hashText(text: string): string {
    const cleaned = preprocessTextForTTS(text);
    return createHash('sha256').update(cleaned).digest('hex');
  }

  async getCachedParagraphAudio(
    storyId: string,
    text: string,
    voiceId: string,
    provider?: string,
  ): Promise<string | null> {
    const textHash = this.hashText(text);
    const cached = await this.prisma.paragraphAudioCache.findFirst({
      where: { storyId, textHash, voiceId, ...(provider ? { provider } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return cached?.audioUrl ?? null;
  }

  async cacheParagraphAudio(
    storyId: string,
    text: string,
    voiceId: string,
    audioUrl: string,
    provider: string,
  ): Promise<void> {
    const textHash = this.hashText(text);
    await this.prisma.paragraphAudioCache.upsert({
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

  /**
   * Query paragraph audio cache for a specific provider and split hashMap entries
   * into cached (with audioUrl) and uncached (needing generation) arrays.
   */
  async rebuildCacheForProvider(
    provider: 'elevenlabs' | 'deepgram' | 'edgetts',
    hashMap: Map<string, Array<{ index: number; text: string }>>,
    storyId: string,
    voiceId: string,
  ): Promise<{
    cached: Array<{ index: number; text: string; audioUrl: string }>;
    uncached: Array<{
      index: number;
      text: string;
      hash: string;
      duplicateIndices?: number[];
    }>;
  }> {
    const entries = await this.prisma.paragraphAudioCache.findMany({
      where: {
        storyId,
        voiceId,
        provider,
        textHash: { in: [...hashMap.keys()] },
      },
      orderBy: { createdAt: 'desc' },
    });
    // desc order + skip-if-exists ensures the newest cache entry wins.
    const cacheMap = new Map<string, string>();
    for (const e of entries) {
      if (!cacheMap.has(e.textHash)) {
        cacheMap.set(e.textHash, e.audioUrl);
      }
    }

    const cached: Array<{ index: number; text: string; audioUrl: string }> = [];
    const uncached: Array<{
      index: number;
      text: string;
      hash: string;
      duplicateIndices?: number[];
    }> = [];

    for (const [hash, hashEntries] of hashMap) {
      const cachedUrl = cacheMap.get(hash);
      if (cachedUrl) {
        for (const { index, text } of hashEntries) {
          cached.push({ index, text, audioUrl: cachedUrl });
        }
      } else {
        const entry: (typeof uncached)[number] = {
          index: hashEntries[0].index,
          text: hashEntries[0].text,
          hash,
        };
        if (hashEntries.length > 1) {
          entry.duplicateIndices = hashEntries.slice(1).map((e) => e.index);
        }
        uncached.push(entry);
      }
    }

    return { cached, uncached };
  }
}
