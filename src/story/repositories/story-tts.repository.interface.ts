import type { ParagraphAudioCache, Voice } from '@prisma/client';

// ==================== Repository Interface ====================
// DB access for the story TTS pipeline: content-addressed paragraph-audio
// cache reads/writes and custom-voice resolution. Every query here mirrors the
// original inline Prisma calls byte-for-byte so cached-audio semantics stay
// stable.
export interface IStoryTtsRepository {
  // Find the newest cached paragraph audio for a story/voice, optionally
  // scoped to a specific provider.
  findCachedParagraphAudio(
    storyId: string,
    textHash: string,
    voiceId: string,
    provider?: string,
  ): Promise<ParagraphAudioCache | null>;

  // Upsert a cached paragraph-audio entry keyed by
  // (storyId, textHash, voiceId, provider).
  upsertParagraphAudio(
    storyId: string,
    textHash: string,
    voiceId: string,
    audioUrl: string,
    provider: string,
  ): Promise<ParagraphAudioCache>;

  // Find all cached paragraph-audio entries for a story/voice/provider whose
  // textHash is in the provided set, newest first.
  findParagraphAudioForProvider(
    storyId: string,
    voiceId: string,
    provider: string,
    textHashes: string[],
  ): Promise<ParagraphAudioCache[]>;

  // Find cached paragraph-audio entries for a story whose voiceId is any of
  // `voiceIds` and whose textHash is in the set, restricted to `providers`, newest
  // first. Used by guest playback, which accepts any existing default-voice row.
  findParagraphAudioForVoices(
    storyId: string,
    voiceIds: string[],
    providers: readonly string[],
    textHashes: string[],
  ): Promise<ParagraphAudioCache[]>;

  // Voice-table ids (non-deleted) backed by the given ElevenLabs voice id.
  findVoiceIdsByElevenLabsId(elevenLabsVoiceId: string): Promise<string[]>;

  // Resolve a custom voice by id or name (non-deleted only).
  findVoiceByIdOrName(type: string): Promise<Voice | null>;
}

export const STORY_TTS_REPOSITORY = Symbol('STORY_TTS_REPOSITORY');
