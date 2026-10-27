import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { IStoryTtsRepository } from '../repositories/story-tts.repository.interface';
import { preprocessTextForTTS } from './tts-text.util';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../../voice/dto/voice.dto';
import { DEFAULT_VOICE, VOICE_CONFIG } from '../../voice/voice.constants';

/**
 * Providers whose cached audio guests may be served. ElevenLabs is a paid
 * benefit, so its rows (and untracked 'unknown' ones) are never returned to
 * guests. Best-first.
 */
export const GUEST_CACHE_PROVIDERS = ['deepgram', 'edgetts'] as const;
const PROVIDER_RANK: readonly string[] = GUEST_CACHE_PROVIDERS;
const providerRank = (p: string): number => {
  const i = PROVIDER_RANK.indexOf(p);
  return i === -1 ? PROVIDER_RANK.length : i;
};

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

  /**
   * Every `paragraph_audio_cache.voiceId` spelling that denotes the DEFAULT
   * voice: the 'default' placeholder the web sends when no voice is chosen,
   * the VoiceType key, legacy codenames migrated to it, its ElevenLabs id, and
   * any Voice-table UUIDs backed by that ElevenLabs id.
   */
  async getDefaultVoiceAliases(): Promise<string[]> {
    const elevenLabsId = VOICE_CONFIG[DEFAULT_VOICE].elevenLabsId;
    const legacy = Object.entries(VOICE_TYPE_MIGRATION_MAP)
      .filter(([, target]: [string, VoiceType]) => target === DEFAULT_VOICE)
      .map(([legacyKey]) => legacyKey);
    const uuids =
      await this.ttsRepository.findVoiceIdsByElevenLabsId(elevenLabsId);
    return [
      ...new Set(['default', DEFAULT_VOICE, ...legacy, elevenLabsId, ...uuids]),
    ];
  }

  /**
   * Guest cache lookup: reuse ANY existing default-voice audio produced by a
   * free provider (deepgram/edgetts; never ElevenLabs). Picks the provider covering the most paragraphs (ties
   * go to the best provider) so a story stays in one voice where possible, then
   * fills remaining gaps from other providers — an existing clip is never
   * regenerated.
   */
  async rebuildCacheForDefaultVoice(
    hashMap: Map<string, Array<{ index: number; text: string }>>,
    storyId: string,
  ): Promise<{
    cached: Array<{ index: number; text: string; audioUrl: string }>;
    uncached: Array<{
      index: number;
      text: string;
      hash: string;
      duplicateIndices?: number[];
    }>;
  }> {
    const aliases = await this.getDefaultVoiceAliases();
    const rows = await this.ttsRepository.findParagraphAudioForVoices(
      storyId,
      aliases,
      GUEST_CACHE_PROVIDERS,
      [...hashMap.keys()],
    );

    // provider -> hash -> newest audioUrl (rows arrive newest first)
    const byProvider = new Map<string, Map<string, string>>();
    for (const row of rows) {
      // Defence in depth: never trust the query alone with the paid boundary.
      if (!(GUEST_CACHE_PROVIDERS as readonly string[]).includes(row.provider))
        continue;
      const perHash = byProvider.get(row.provider) ?? new Map<string, string>();
      if (!perHash.has(row.textHash)) perHash.set(row.textHash, row.audioUrl);
      byProvider.set(row.provider, perHash);
    }
    const providers = [...byProvider.keys()].sort(
      (a, b) =>
        byProvider.get(b)!.size - byProvider.get(a)!.size ||
        providerRank(a) - providerRank(b),
    );

    const cacheMap = new Map<string, string>();
    for (const provider of providers) {
      for (const [hash, url] of byProvider.get(provider)!) {
        if (!cacheMap.has(hash)) cacheMap.set(hash, url);
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
      const url = cacheMap.get(hash);
      if (url) {
        for (const { index, text } of hashEntries) {
          cached.push({ index, text, audioUrl: url });
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
