import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { InMemoryRedis } from '@/shared/testing/passwordless-fakes';

const DAY_SECONDS = 24 * 60 * 60;

describe('PasswordlessThrottleService.mark', () => {
  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-03-01T00:00:00Z') }),
  );
  afterEach(() => jest.useRealTimers());

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
