import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import {
  CircuitBreakerService,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';
import { TTS_BREAKER_NAMES } from '@/shared/constants/circuit-breaker.constants';

@Injectable()
export class TTSCircuitBreakerHealthIndicator {
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
