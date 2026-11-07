import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { InMemoryRedis } from '@/shared/testing/passwordless-fakes';

const DAY_SECONDS = 24 * 60 * 60;
const HOUR_MS = 3_600_000;

beforeEach(() => jest.useFakeTimers({ now: new Date('2026-03-01T00:00:00Z') }));
afterEach(() => jest.useRealTimers());

describe('PasswordlessThrottleService.mark', () => {
  it('expires a marker after its ttl', async () => {
    const throttle = new PasswordlessThrottleService(
      new InMemoryRedis() as never,
    );
    await throttle.mark('k', 90 * DAY_SECONDS);
    jest.advanceTimersByTime(91 * DAY_SECONDS * 1000);
    expect(await throttle.peek('k')).toBe(0);
  });

  it('refreshes the ttl when marked again, like a plain SET EX', async () => {
    const throttle = new PasswordlessThrottleService(
      new InMemoryRedis() as never,
    );
    await throttle.mark('k', 90 * DAY_SECONDS);
    jest.advanceTimersByTime(60 * DAY_SECONDS * 1000);
    await throttle.mark('k', 90 * DAY_SECONDS);
    jest.advanceTimersByTime(60 * DAY_SECONDS * 1000);
    expect(await throttle.peek('k')).toBeGreaterThan(0);
  });
});

describe('PasswordlessThrottleService.release', () => {
  it('takes one off a live counter', async () => {
    const redis = new InMemoryRedis();
    const throttle = new PasswordlessThrottleService(redis as never);
    await throttle.hit('k', HOUR_MS);
    await throttle.hit('k', HOUR_MS);

    await throttle.release('k', HOUR_MS);

    expect(await redis.client.get('k')).toBe('1');
  });

  it('never leaves a negative counter without a ttl when the key already expired', async () => {
    const redis = new InMemoryRedis();
    const throttle = new PasswordlessThrottleService(redis as never);
    await throttle.hit('k', HOUR_MS);
    jest.advanceTimersByTime(2 * HOUR_MS);

    await throttle.release('k', HOUR_MS);

    expect(await redis.client.get('k')).toBe('0');
    jest.advanceTimersByTime(2 * HOUR_MS);
    expect(await redis.client.get('k')).toBeNull();
  });
});
