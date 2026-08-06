import {
  CircuitBreaker,
  CircuitBreakerService,
  CircuitState,
  isTransientError,
} from './circuit-breaker.service';

describe('isTransientError', () => {
  it('should classify 429 status as transient', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ statusCode: 429 })).toBe(true);
  });

  it('should classify 5xx status as transient', () => {
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ statusCode: 504 })).toBe(true);
  });

  it('should classify network errors as transient', () => {
    expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isTransientError(new Error('fetch failed'))).toBe(true);
    expect(isTransientError(new Error('Connection timeout'))).toBe(true);
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
    expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
  });

  it('should NOT classify 4xx client errors as transient', () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 403 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError({ status: 422 })).toBe(false);
  });

  it('should NOT classify non-error values as transient', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError('string error')).toBe(false);
    expect(isTransientError(42)).toBe(false);
  });

  it('should NOT classify validation errors as transient', () => {
    expect(isTransientError(new Error('Validation failed'))).toBe(false);
    expect(isTransientError(new Error('Invalid input'))).toBe(false);
  });
});

describe('CircuitBreaker', () => {
  const defaultConfig = {
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    halfOpenMaxAttempts: 1,
  };

  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', defaultConfig);
  });

  it('should start in CLOSED state', () => {
    const snapshot = breaker.getSnapshot();
    expect(snapshot.state).toBe(CircuitState.CLOSED);
    expect(snapshot.failureCount).toBe(0);
    expect(snapshot.lastFailureTime).toBeNull();
  });

  it('should allow requests when CLOSED', () => {
    expect(breaker.canExecute()).toBe(true);
  });

  it('should open after N transient failures', () => {
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure({ status: 500 });
    }
    expect(breaker.getSnapshot().state).toBe(CircuitState.OPEN);
    expect(breaker.canExecute()).toBe(false);
  });

  it('should NOT open for non-transient errors', () => {
    for (let i = 0; i < 10; i++) {
      breaker.recordFailure({ status: 400 });
    }
    expect(breaker.getSnapshot().state).toBe(CircuitState.CLOSED);
    expect(breaker.canExecute()).toBe(true);
  });

  it('should fast-fail when OPEN', () => {
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure({ status: 500 });
    }
    expect(breaker.canExecute()).toBe(false);
    expect(breaker.canExecute()).toBe(false);
  });

  it('should transition OPEN → HALF_OPEN after timeout', () => {
    const fastBreaker = new CircuitBreaker('fast-test', {
      ...defaultConfig,
      resetTimeoutMs: 0, // Immediately transition
    });
    for (let i = 0; i < 3; i++) {
      fastBreaker.recordFailure({ status: 500 });
    }
    expect(fastBreaker.getSnapshot().state).toBe(CircuitState.OPEN);

    // canExecute should transition to HALF_OPEN since resetTimeoutMs is 0
    expect(fastBreaker.canExecute()).toBe(true);
    expect(fastBreaker.getSnapshot().state).toBe(CircuitState.HALF_OPEN);
  });

  it('should close on success in HALF_OPEN', () => {
    const fastBreaker = new CircuitBreaker('fast-test', {
      ...defaultConfig,
      resetTimeoutMs: 0,
    });
    for (let i = 0; i < 3; i++) {
      fastBreaker.recordFailure({ status: 500 });
    }
    // Transition to HALF_OPEN
    fastBreaker.canExecute();
    expect(fastBreaker.getSnapshot().state).toBe(CircuitState.HALF_OPEN);

    fastBreaker.recordSuccess();
    expect(fastBreaker.getSnapshot().state).toBe(CircuitState.CLOSED);
    expect(fastBreaker.getSnapshot().failureCount).toBe(0);
  });

  it('should re-open on failure in HALF_OPEN', () => {
    const fastBreaker = new CircuitBreaker('fast-test', {
      ...defaultConfig,
      resetTimeoutMs: 0,
    });
    for (let i = 0; i < 3; i++) {
      fastBreaker.recordFailure({ status: 500 });
    }
    // Transition to HALF_OPEN
    fastBreaker.canExecute();
    expect(fastBreaker.getSnapshot().state).toBe(CircuitState.HALF_OPEN);

    fastBreaker.recordFailure({ status: 503 });
    expect(fastBreaker.getSnapshot().state).toBe(CircuitState.OPEN);
  });

  it('should reset failure count on success', () => {
    breaker.recordFailure({ status: 500 });
    breaker.recordFailure({ status: 500 });
    expect(breaker.getSnapshot().failureCount).toBe(2);

    breaker.recordSuccess();
    expect(breaker.getSnapshot().failureCount).toBe(0);
  });

  it('should limit HALF_OPEN attempts', () => {
    const fastBreaker = new CircuitBreaker('fast-test', {
      ...defaultConfig,
      resetTimeoutMs: 0,
      halfOpenMaxAttempts: 1,
    });
    for (let i = 0; i < 3; i++) {
      fastBreaker.recordFailure({ status: 500 });
    }
    // First call transitions to HALF_OPEN and allows
    expect(fastBreaker.canExecute()).toBe(true);
    // Second call should deny (max attempts reached)
    expect(fastBreaker.canExecute()).toBe(false);
  });

  it('should report name in snapshot', () => {
    expect(breaker.getSnapshot().name).toBe('test');
  });
});

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  it('should create and return a breaker', () => {
    const breaker = service.getBreaker('test-breaker');
    expect(breaker).toBeInstanceOf(CircuitBreaker);
    expect(breaker.name).toBe('test-breaker');
  });

  it('should return the same breaker for the same name', () => {
    const b1 = service.getBreaker('same');
    const b2 = service.getBreaker('same');
    expect(b1).toBe(b2);
  });

  it('should create distinct breakers for different names', () => {
    const b1 = service.getBreaker('a');
    const b2 = service.getBreaker('b');
    expect(b1).not.toBe(b2);
  });

  it('should apply custom config on creation', () => {
    const breaker = service.getBreaker('custom', { failureThreshold: 1 });
    breaker.recordFailure({ status: 500 });
    expect(breaker.getSnapshot().state).toBe(CircuitState.OPEN);
  });

  it('should return all breakers', () => {
    service.getBreaker('a');
    service.getBreaker('b');
    const all = service.getAllBreakers();
    expect(all.size).toBe(2);
    expect(all.has('a')).toBe(true);
    expect(all.has('b')).toBe(true);
  });
});
