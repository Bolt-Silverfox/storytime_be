import { CircuitBreakerHealthIndicator } from './circuit-breaker.health';
import { HealthCheckError } from '@nestjs/terminus';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

describe('CircuitBreakerHealthIndicator', () => {
  let indicator: CircuitBreakerHealthIndicator;
  let cbService: CircuitBreakerService;

  beforeEach(() => {
    cbService = new CircuitBreakerService();
    indicator = new CircuitBreakerHealthIndicator(cbService);
  });

  it('should report healthy when all breakers are CLOSED', () => {
    cbService.getBreaker('gemini');
    cbService.getBreaker('hf-image');

    const result = indicator.isHealthy('circuit_breakers');
    expect(result['circuit_breakers'].status).toBe('up');
    expect(result['circuit_breakers'].gemini.state).toBe('CLOSED');
    expect(result['circuit_breakers']['hf-image'].state).toBe('CLOSED');
  });

  it('should report healthy when no breakers exist', () => {
    const result = indicator.isHealthy('circuit_breakers');
    expect(result['circuit_breakers'].status).toBe('up');
  });

  it('should report unhealthy and include all breakers when any is OPEN', () => {
    expect.assertions(4);

    const breaker = cbService.getBreaker('gemini', {
      failureThreshold: 2,
    });
    cbService.getBreaker('hf-image');

    // Drive the gemini breaker OPEN past its threshold with transient errors
    breaker.recordFailure({ status: 500 });
    breaker.recordFailure({ status: 500 });

    try {
      indicator.isHealthy('circuit_breakers');
    } catch (error) {
      expect(error).toBeInstanceOf(HealthCheckError);
      const details = (error as HealthCheckError).causes['circuit_breakers'];
      expect(details.gemini.state).toBe('OPEN');
      expect(details.gemini.failureCount).toBe(2);
      expect(details['hf-image'].state).toBe('CLOSED');
    }
  });
});
