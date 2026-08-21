import { CircuitBreaker } from '@/shared/services/circuit-breaker.service';
import { withRetry, RetryOptions } from './with-retry';

/** Thrown when a call is rejected because its circuit breaker is OPEN. */
export class CircuitOpenError extends Error {
  constructor(readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Compose a circuit breaker (outer) with retry (inner).
 * - If the breaker is OPEN, fast-fail with CircuitOpenError; `fn` is not run.
 * - Otherwise run `withRetry(fn, opts)`; record ONE success/failure on the
 *   breaker for the whole logical call.
 */
export async function withResilience<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  if (!breaker.canExecute()) {
    throw new CircuitOpenError(breaker.name);
  }
  try {
    const result = await withRetry(fn, opts);
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure(error);
    throw error;
  }
}
