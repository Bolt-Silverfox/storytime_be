import { TTSCircuitBreakerHealthIndicator } from './tts-circuit-breaker.health';
import { HealthCheckError } from '@nestjs/terminus';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

describe('TTSCircuitBreakerHealthIndicator', () => {
  let indicator: TTSCircuitBreakerHealthIndicator;
  let cbService: CircuitBreakerService;

  beforeEach(() => {
    cbService = new CircuitBreakerService();
    indicator = new TTSCircuitBreakerHealthIndicator(cbService);
  });

  it('should report healthy when all breakers are CLOSED', () => {
    cbService.getBreaker('elevenlabs');
    cbService.getBreaker('deepgram');
    cbService.getBreaker('edgetts');

    const result = indicator.isHealthy('tts-providers');
    expect(result['tts-providers'].status).toBe('up');
  });

  it('should report healthy when no breakers exist', () => {
    const result = indicator.isHealthy('tts-providers');
    expect(result['tts-providers'].status).toBe('up');
  });

  it('should report unhealthy when any breaker is OPEN', () => {
    const breaker = cbService.getBreaker('elevenlabs', {
      failureThreshold: 1,
    });
    cbService.getBreaker('deepgram');

    // Trip the breaker
    breaker.recordFailure({ status: 500 });

    expect(() => indicator.isHealthy('tts-providers')).toThrow(
      HealthCheckError,
    );
  });

  it('should include breaker details in the result', () => {
    const breaker = cbService.getBreaker('elevenlabs', {
      failureThreshold: 1,
    });
    cbService.getBreaker('deepgram');

    breaker.recordFailure({ status: 500 });

    try {
      indicator.isHealthy('tts-providers');
    } catch (error) {
      expect(error).toBeInstanceOf(HealthCheckError);
      const healthError = error as HealthCheckError;
      const details = healthError.causes['tts-providers'];
      expect(details.elevenlabs.state).toBe('OPEN');
      expect(details.deepgram.state).toBe('CLOSED');
    }
  });
});
