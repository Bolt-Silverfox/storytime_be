import { TTSCircuitBreakerHealthIndicator } from './tts-circuit-breaker.health';
import { HealthIndicatorService } from '@nestjs/terminus';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

describe('TTSCircuitBreakerHealthIndicator', () => {
  let indicator: TTSCircuitBreakerHealthIndicator;
  let cbService: CircuitBreakerService;

  beforeEach(() => {
    cbService = new CircuitBreakerService();
    indicator = new TTSCircuitBreakerHealthIndicator(
      new HealthIndicatorService(),
      cbService,
    );
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

    // terminus 12 indicators return a `down` result instead of throwing
    expect(
      indicator.isHealthy('tts-providers')['tts-providers'].status,
    ).toBe('down');
  });

  it('should include breaker details in the result', () => {
    expect.assertions(3);

    const breaker = cbService.getBreaker('elevenlabs', {
      failureThreshold: 1,
    });
    cbService.getBreaker('deepgram');

    breaker.recordFailure({ status: 500 });

    const details = indicator.isHealthy('tts-providers')[
      'tts-providers'
    ] as Record<string, any>;
    expect(details.status).toBe('down');
    expect(details.elevenlabs.state).toBe('OPEN');
    expect(details.deepgram.state).toBe('CLOSED');
  });
});
