// ==================== Repository Interface ====================
export interface IParagraphAudioCacheRepository {
  // Get the distinct voiceIds that have cached audio for a story
  findDistinctVoiceIdsForStory(
    storyId: string,
  ): Promise<Array<{ voiceId: string }>>;
}

export const PARAGRAPH_AUDIO_CACHE_REPOSITORY = Symbol(
  'PARAGRAPH_AUDIO_CACHE_REPOSITORY',
);
