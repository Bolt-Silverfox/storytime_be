import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { IStoryTtsRepository } from '../repositories/story-tts.repository.interface';
import { preprocessTextForTTS } from './tts-text.util';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../../voice/dto/voice.dto';
import {
  DEFAULT_VOICE,
  legacyDefaultAliasCutoff,
  VOICE_CONFIG,
} from '../../voice/voice.constants';

/** Best-first. Rows written before provider tracking carry 'unknown'. */
const PROVIDER_RANK = ['elevenlabs', 'deepgram', 'edgetts', 'unknown'];
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
    // The default voice is stored under several spellings/providers (guests
    // write NIMBUS/deepgram; clients send a UUID or the ElevenLabs id). For the
    // non-ElevenLabs (free/guest-tier) path, reuse any existing default-voice
    // clip rather than regenerating it. ElevenLabs batches stay provider-scoped.
    if (
      provider !== 'elevenlabs' &&
      (await this.isDefaultVoiceAlias(voiceId))
    ) {
      return this.rebuildCacheForDefaultVoice(hashMap, storyId);
    }
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

  /** Alias check that degrades to exact-voice lookup if the Voice-table read fails. */
  private async isDefaultVoiceAlias(voiceId: string): Promise<boolean> {
    try {
      return (await this.getDefaultVoiceAliases()).includes(voiceId);
    } catch {
      return false;
    }
  }

  /**
   * Guest cache lookup: reuse ANY existing default-voice audio, whichever
   * provider produced it. Picks the provider covering the most paragraphs (ties
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
    const legacyKeys = new Set(
      Object.entries(VOICE_TYPE_MIGRATION_MAP)
        .filter(([, target]: [string, VoiceType]) => target === DEFAULT_VOICE)
        .map(([k]) => k),
    );
    const rows = await this.ttsRepository.findParagraphAudioForVoices(
      storyId,
      aliases,
      [...hashMap.keys()],
    );

    // provider -> hash -> newest audioUrl (rows arrive newest first)
    const byProvider = new Map<string, Map<string, string>>();
    for (const row of rows) {
      // Rows under the 'default' placeholder or a legacy voice name (LILY)
      // were only the current Nimbus voice from a per-provider instant; older
      // ones are a different voice and must not be served as Nimbus.
      const isPlaceholder = row.voiceId === 'default';
      if (
        (isPlaceholder || legacyKeys.has(row.voiceId)) &&
        new Date(row.createdAt) <
          legacyDefaultAliasCutoff(row.provider, isPlaceholder)
      ) {
        continue;
      }
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
