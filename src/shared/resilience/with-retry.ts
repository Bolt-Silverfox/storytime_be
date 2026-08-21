import { isTransientError } from '@/shared/services/circuit-breaker.service';

export interface RetryOptions {
  /** Number of retries AFTER the first attempt. Default 2. */
  retries?: number;
  /** Base backoff delay in ms (grows 2^attempt). Default 300. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay. Default 5000. */
  maxDelayMs?: number;
  /** Apply full jitter (random(0, cappedDelay)). Default true. */
  jitter?: boolean;
  /** Whether an error is worth retrying. Default: isTransientError. */
  isRetryable?: (error: unknown) => boolean;
  /** Observability hook, called before each backoff wait. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + full jitter.
 * Rethrows the ORIGINAL error when retries are exhausted or the error is not
 * retryable. `retries: 0` runs `fn` exactly once.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 300,
    maxDelayMs = 5000,
    jitter = true,
    isRetryable = isTransientError,
    onRetry,
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = jitter ? Math.random() * capped : capped;
      onRetry?.(attempt + 1, error, delay);
      await sleep(delay);
      attempt++;
    }
  }
}
