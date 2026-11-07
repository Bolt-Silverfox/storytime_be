import { Redis } from 'ioredis';
import { PasswordlessThrottleService } from './passwordless-throttle.service';

const url = process.env.PASSWORDLESS_TEST_REDIS_URL;
const maybe = url ? describe : describe.skip;

maybe('PasswordlessThrottleService against real Redis', () => {
  let client: Redis;
  let throttle: PasswordlessThrottleService;
  const prefix = `pwl-it-${process.pid}:`;

  beforeAll(() => {
    client = new Redis(url as string);
    throttle = new PasswordlessThrottleService({ client } as never);
  });

  afterAll(async () => {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) await client.del(...keys);
    await client.quit();
  });

  it('counts hits and expires the window', async () => {
    const key = `${prefix}hit`;
    expect(await throttle.hit(key, 60_000)).toBe(1);
    expect(await throttle.hit(key, 60_000)).toBe(2);
    expect(await client.pttl(key)).toBeGreaterThan(0);
  });

  it('releases one from a live counter', async () => {
    const key = `${prefix}live`;
    await throttle.hit(key, 60_000);
    await throttle.hit(key, 60_000);

    await throttle.release(key, 60_000);

    expect(await client.get(key)).toBe('1');
  });

  it('leaves 0 with a ttl, not -1 without one, when the key already expired', async () => {
    const key = `${prefix}gone`;

    await throttle.release(key, 60_000);

    expect(await client.get(key)).toBe('0');
    expect(await client.pttl(key)).toBeGreaterThan(0);
  });

  it('keeps the exact count when releases race with hits', async () => {
    const key = `${prefix}race`;
    for (let i = 0; i < 50; i++) await throttle.hit(key, 60_000);

    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        i % 2 ? throttle.hit(key, 60_000) : throttle.release(key, 60_000),
      ),
    );

    expect(await client.get(key)).toBe('50');
    expect(await client.pttl(key)).toBeGreaterThan(0);
  });
});
