import { withRetry } from './with-retry';

describe('withRetry', () => {
  it('returns immediately on first success without delay', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures up to `retries` then rethrows the original error', async () => {
    const err = { status: 503 };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 0, jitter: false }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does not retry non-transient errors', async () => {
    const err = { status: 400 };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 0 })).rejects.toBe(
      err,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries: 0 means a single attempt', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 500 });
    await expect(withRetry(fn, { retries: 0 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors a custom isRetryable predicate', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('nope'));
    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 0, isRetryable: () => false }),
    ).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps delay at maxDelayMs and stays within full-jitter bounds', async () => {
    const delays: number[] = [];
    const fn = jest.fn().mockRejectedValue({ status: 500 });
    await expect(
      withRetry(fn, {
        retries: 3,
        baseDelayMs: 100,
        maxDelayMs: 250,
        jitter: true,
        onRetry: (_a, _e, d) => delays.push(d),
      }),
    ).rejects.toBeDefined();
    // computed caps: 100, 200, 250; full jitter => 0..cap
    expect(delays.length).toBe(3);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[2]).toBeLessThanOrEqual(250);
  });
});
