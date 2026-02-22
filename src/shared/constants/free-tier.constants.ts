import { VoiceType } from '@/voice/dto/voice.dto';

export const FREE_TIER_LIMITS = {
  STORIES: {
    BASE_LIMIT: 10, // 10 unique stories lifetime
    WEEKLY_BONUS: 1, // +1 bonus story per week
  },
  VOICES: {
    DEFAULT_VOICE: VoiceType.LILY,
    CUSTOM_SLOTS: 0, // Free users can only use the default voice
  },
};
