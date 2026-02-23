import { DEFAULT_VOICE } from '@/voice/voice.constants';

export const FREE_TIER_LIMITS = {
  STORIES: {
    BASE_LIMIT: 10, // 10 unique stories lifetime
    WEEKLY_BONUS: 1, // +1 bonus story per week
  },
  VOICES: {
    DEFAULT_VOICE,
    CUSTOM_SLOTS: 0, // Free users get ONLY the default voice
  },
};
