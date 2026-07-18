import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { IStoryTtsRepository } from '../repositories/story-tts.repository.interface';
import { preprocessTextForTTS } from './tts-text.util';

/**
 * Owns the paragraph-audio cache: content-addressed hashing plus read/write
 * against `paragraphAudioCache`. Cache keys are `hashText`-derived so they
 * must stay stable byte-for-byte.
 */
@Injectable()
export class TtsCacheService {
  constructor(private readonly ttsRepository: IStoryTtsRepository) {}

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
    const cached = await this.ttsRepository.findCachedParagraphAudio(
      storyId,
      textHash,
      voiceId,
      provider,
    );
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
    await this.ttsRepository.upsertParagraphAudio(
      storyId,
      textHash,
      voiceId,
      audioUrl,
      provider,
    );
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
    const entries = await this.ttsRepository.findParagraphAudioForProvider(
      storyId,
      voiceId,
      provider,
      [...hashMap.keys()],
    );
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
