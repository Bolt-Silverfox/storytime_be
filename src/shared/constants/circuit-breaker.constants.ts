export const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 1,
} as const;

export const TTS_CIRCUIT_BREAKER_CONFIG = {
  elevenlabs: {
    failureThreshold: 3, // Lower: already retries 3x internally
    resetTimeoutMs: 90_000, // Longer: ElevenLabs rate limits are ~60s windows
    halfOpenMaxAttempts: 1,
  },
  deepgram: {
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    halfOpenMaxAttempts: 1,
  },
  edgetts: {
    failureThreshold: 5,
    resetTimeoutMs: 30_000, // Shorter: free service, recovers quickly
    halfOpenMaxAttempts: 1,
  },
} as const;

/** Breaker names used by the TTS health indicator to filter from getAllBreakers() */
export const TTS_BREAKER_NAMES: ReadonlyArray<string> = Object.keys(
  TTS_CIRCUIT_BREAKER_CONFIG,
);
