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
import { TTS_BREAKER_NAMES } from '@/shared/constants/circuit-breaker.constants';

@Injectable()
export class TTSCircuitBreakerHealthIndicator extends HealthIndicator {
  constructor(private readonly cbService: CircuitBreakerService) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const allBreakers = this.cbService.getAllBreakers();
    const details: Record<
      string,
      { state: string; failureCount: number; lastFailureTime: number | null }
    > = {};
    let hasOpenBreaker = false;

    for (const [name, breaker] of allBreakers) {
      if (!TTS_BREAKER_NAMES.includes(name)) continue;

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
