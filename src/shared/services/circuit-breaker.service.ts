import { Injectable, Logger } from '@nestjs/common';
import { CIRCUIT_BREAKER_DEFAULTS } from '@/shared/constants/circuit-breaker.constants';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
}

/**
 * Determines whether an error represents a transient failure that should
 * count toward opening the circuit breaker (5xx, 429, network errors).
 * Non-transient errors (400, 401, 403, validation) are ignored.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // HTTP status-based classification
  const status = Number(err.status ?? err.statusCode ?? err.code ?? 0);
  if (status === 429 || (status >= 500 && status < 600)) return true;

  // Message-based classification for network-level failures
  const message =
    error instanceof Error
      ? error.message
      : typeof err.message === 'string'
        ? err.message
        : '';
  if (
    message.includes('ETIMEDOUT') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('socket hang up') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ECONNRESET')
  ) {
    return true;
  }

  return false;
}

export class CircuitBreaker {
  private readonly logger: Logger;
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenAttempts = 0;

  constructor(
    readonly name: string,
    private readonly config: CircuitBreakerConfig,
  ) {
    this.logger = new Logger(`CircuitBreaker:${name}`);
  }

  /**
   * Returns true if a request should proceed, false if the circuit is
   * OPEN and the caller should fast-fail. Handles OPEN → HALF_OPEN
   * transition when the reset timeout has elapsed.
   */
  canExecute(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (
          this.lastFailureTime !== null &&
          now - this.lastFailureTime >= this.config.resetTimeoutMs
        ) {
          this.transition(CircuitState.HALF_OPEN);
          this.halfOpenAttempts = 1; // This call counts as the first attempt
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        if (this.halfOpenAttempts < this.config.halfOpenMaxAttempts) {
          this.halfOpenAttempts++;
          return true;
        }
        return false;
    }
  }

  recordSuccess(): void {
    if (this.state !== CircuitState.CLOSED) {
      this.transition(CircuitState.CLOSED);
    }
    this.failureCount = 0;
  }

  recordFailure(error: unknown): void {
    if (!isTransientError(error)) return;

    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transition(CircuitState.OPEN);
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transition(CircuitState.OPEN);
    }
  }

  getSnapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  private transition(newState: CircuitState): void {
    this.logger.warn(
      `${this.name}: ${this.state} → ${newState} (failures: ${this.failureCount})`,
    );
    this.state = newState;
    if (newState === CircuitState.CLOSED) {
      this.halfOpenAttempts = 0;
    }
  }
}

@Injectable()
export class CircuitBreakerService {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a named circuit breaker instance.
   * If the breaker already exists, the existing instance is returned
   * (config is only applied on first creation).
   */
  getBreaker(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, {
        ...CIRCUIT_BREAKER_DEFAULTS,
        ...config,
      });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  getAllBreakers(): ReadonlyMap<string, CircuitBreaker> {
    return this.breakers;
  }
}
