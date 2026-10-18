import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import {
  CircuitBreakerService,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';

/**
 * Reports the state of ALL registered circuit breakers (not just TTS),
 * so newly-added breakers (gemini, hf-image, voice-library, payment, etc.)
 * are observable via the health endpoint.
 */
@Injectable()
export class CircuitBreakerHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly cbService: CircuitBreakerService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const allBreakers = this.cbService.getAllBreakers();
    const details: Record<
      string,
      { state: string; failureCount: number; lastFailureTime: number | null }
    > = {};
    let hasOpenBreaker = false;

    for (const [name, breaker] of allBreakers) {
      const snapshot = breaker.getSnapshot();
      details[name] = {
        state: snapshot.state,
        failureCount: snapshot.failureCount,
        lastFailureTime: snapshot.lastFailureTime,
      };
      if (snapshot.state === CircuitState.OPEN) {
        hasOpenBreaker = true;
      }
    }

    const session = this.healthIndicatorService.check(key);
      const result = hasOpenBreaker
        ? session.down(details)
        : session.up(details);

    if (hasOpenBreaker) {
      return result;
    }

    return result;
  }
}
