import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import {
  CircuitBreakerService,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';

@Injectable()
export class TTSCircuitBreakerHealthIndicator extends HealthIndicator {
  constructor(private readonly cbService: CircuitBreakerService) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const breakers = this.cbService.getAllBreakers();
    const details: Record<
      string,
      { state: string; failureCount: number; lastFailureTime: number | null }
    > = {};
    let hasOpenBreaker = false;

    for (const [name, breaker] of breakers) {
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

    const result = this.getStatus(key, !hasOpenBreaker, details);

    if (hasOpenBreaker) {
      throw new HealthCheckError('TTS circuit breaker(s) OPEN', result);
    }

    return result;
  }
}
