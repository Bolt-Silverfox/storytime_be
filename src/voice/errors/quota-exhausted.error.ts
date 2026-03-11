/**
 * Thrown when a TTS provider returns 402 Payment Required,
 * indicating the account quota/credits are exhausted.
 * Callers should fall back to the next provider immediately
 * without retrying.
 */
export class QuotaExhaustedError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`${provider} quota exhausted (402 Payment Required)`);
    this.name = 'QuotaExhaustedError';
    this.provider = provider;
  }
}
