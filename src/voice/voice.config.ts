/** Max character length accepted for TTS input */
export const MAX_TTS_TEXT_LENGTH = 50_000;

export const VOICE_CONFIG_SETTINGS = {
  MODELS: {
    DEFAULT: 'eleven_multilingual_v2',
    TURBO: 'eleven_turbo_v2_5',
  },
  QUOTAS: {
    FREE: 2,
    PREMIUM: 20,
  },
  DEEPGRAM: {
    DEFAULT_MODEL: 'aura-2-hera-en',
    ENCODING: 'mp3',
    TIMEOUT_MS: 30_000,
    CHUNK_SIZE: 2000,
  },
  EDGE_TTS: {
    RATE: -10,
    OUTPUT_FORMAT: 'audio-24khz-96kbitrate-mono-mp3',
    CHUNK_SIZE: 3000,
    TIMEOUT_MS: 30_000,
  },
  ELEVEN_LABS: {
    DEFAULT_SETTINGS: {
      STABILITY: 0.35,
      SIMILARITY_BOOST: 0.8,
      STYLE: 0.55,
      USE_SPEAKER_BOOST: true,
    },
  },
};
