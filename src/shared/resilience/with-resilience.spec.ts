import { withResilience, CircuitOpenError } from './with-resilience';
import {
  CircuitBreaker,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';

const makeBreaker = () =>
  new CircuitBreaker('test', {
    failureThreshold: 2,
    resetTimeoutMs: 60_000,
    halfOpenMaxAttempts: 1,
  });

describe('withResilience', () => {
  it('fast-fails with CircuitOpenError when breaker is OPEN, never calling fn', async () => {
    const breaker = makeBreaker();
    // Trip it: 2 transient failures.
    breaker.recordFailure({ status: 500 });
    breaker.recordFailure({ status: 500 });
    expect(breaker.getSnapshot().state).toBe(CircuitState.OPEN);
    const fn = jest.fn();
    await expect(withResilience(breaker, fn)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('records exactly one success on success, regardless of inner retries', async () => {
    const breaker = makeBreaker();
    const spy = jest.spyOn(breaker, 'recordSuccess');
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    await expect(
      withResilience(breaker, fn, { retries: 2, baseDelayMs: 0 }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('records exactly one failure after retries are exhausted', async () => {
    const breaker = makeBreaker();
    const spy = jest.spyOn(breaker, 'recordFailure');
    const err = { status: 500 };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withResilience(breaker, fn, { retries: 2, baseDelayMs: 0 }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    // recordFailure is called once by withResilience for the logical call.
    // (The breaker internally may also be invoked; assert at least the
    // withResilience-level single call by checking it was called with the error.)
    expect(spy).toHaveBeenCalledWith(err);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
