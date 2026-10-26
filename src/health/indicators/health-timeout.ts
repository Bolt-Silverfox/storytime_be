/**
 * Upper bound for a single dependency probe. BullMQ/ioredis queue commands
 * offline while Redis is unreachable and never reject, so every probe that
 * touches them must race against this deadline. Kept well under the deploy
 * scripts' curl --max-time (10s).
 */
export const HEALTH_CHECK_TIMEOUT_MS = 3000;

let timeoutOverrideMs: number | undefined;

/** Effective probe deadline: the production default unless a test overrides it. */
export function getHealthTimeoutMs(): number {
  return timeoutOverrideMs ?? HEALTH_CHECK_TIMEOUT_MS;
}

/** Test seam only: pass undefined to restore the production default. */
export function setHealthTimeoutMsForTesting(ms: number | undefined): void {
  timeoutOverrideMs = ms;
}

export class HealthCheckTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`timeout after ${timeoutMs}ms`);
    this.name = 'HealthCheckTimeoutError';
  }
}

/**
 * Settles with `work`, or rejects with HealthCheckTimeoutError once
 * `timeoutMs` elapses. The timer is always cleared, so a fast probe leaves no
 * pending handle behind. The underlying promise cannot be cancelled; its late
 * outcome is swallowed so it cannot surface as an unhandled rejection.
 */
export async function withHealthTimeout<T>(
  work: Promise<T>,
  timeoutMs: number = getHealthTimeoutMs(),
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HealthCheckTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
