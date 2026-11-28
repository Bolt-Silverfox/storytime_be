import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { closeRedisAfter } from '@/shared/testing/close-redis';

const url = process.env.PASSWORDLESS_TEST_REDIS_URL;
const maybe = url ? describe : describe.skip;

maybe('PasswordlessThrottleService against real Redis', () => {
  let client: Redis;
  let throttle: PasswordlessThrottleService;
  const prefix = `pwl-it-${randomUUID()}:`;
  const used = new Set<string>();
  const fixtureKey = (name: string) => {
    const key = `${prefix}${name}`;
    used.add(key);
    return key;
  };

  beforeAll(() => {
    client = new Redis(url as string);
    throttle = new PasswordlessThrottleService({ client } as never);
  });

  afterAll(() =>
    closeRedisAfter(client, () =>
      used.size ? client.del([...used]) : Promise.resolve(),
    ),
  );

  it('counts hits and expires the window', async () => {
    const key = fixtureKey('hit');
    expect(await throttle.hit(key, 60_000)).toBe(1);
    expect(await throttle.hit(key, 60_000)).toBe(2);
    const ttl = await client.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('releases one from a live counter', async () => {
    const key = fixtureKey('live');
    await throttle.hit(key, 60_000);
    await throttle.hit(key, 60_000);

    await throttle.release(key, 60_000);

    expect(await client.get(key)).toBe('1');
  });

  it('leaves 0 with a ttl, not -1 without one, when the key already expired', async () => {
    const key = fixtureKey('gone');

    await throttle.release(key, 60_000);

    expect(await client.get(key)).toBe('0');
    expect(await client.pttl(key)).toBeGreaterThan(0);
  });

  it('keeps the window expiry when a live counter released to zero is hit again', async () => {
    const key = fixtureKey('rezero');
    await throttle.hit(key, 60_000);
    await client.pexpire(key, 5_000);
    await throttle.release(key, 60_000);

    expect(await throttle.hit(key, 60_000)).toBe(1);

    const ttl = await client.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5_000);
  });

  it('admits up to the limit and refuses without counting the refused call', async () => {
    const key = fixtureKey('admit');
    const budget = [{ key, windowMs: 60_000, max: 2 }];

    expect(await throttle.admit(budget)).toBe(1);
    expect(await throttle.admit(budget)).toBe(2);
    expect(await throttle.admit(budget)).toBe(0);

    expect(await client.get(key)).toBe('2');
    const ttl = await client.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('charges no budget when any one of them is spent', async () => {
    const open = fixtureKey('admit-open');
    const spent = fixtureKey('admit-spent');
    await client.set(spent, '3', 'PX', 60_000);

    expect(
      await throttle.admit([
        { key: open, windowMs: 60_000, max: 10 },
        { key: spent, windowMs: 60_000, max: 3 },
      ]),
    ).toBe(0);

    expect(await client.get(open)).toBeNull();
    expect(await client.get(spent)).toBe('3');
  });

  it('admits exactly the limit when admissions run concurrently', async () => {
    const key = fixtureKey('admit-race');
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        throttle.admit([{ key, windowMs: 60_000, max: 20 }]),
      ),
    );

    expect(results.filter((n) => n > 0)).toHaveLength(20);
    expect(await client.get(key)).toBe('20');
  });

  describe('charges', () => {
    const budget = (key: string, max = 3) => ({ key, windowMs: 60_000, max });

    it('charges up to the limit, refuses without storing the refused charge and sets the window', async () => {
      const key = fixtureKey('charge');

      expect(await throttle.charge(budget(key), 'a')).toBe(1);
      expect(await throttle.charge(budget(key), 'b')).toBe(2);
      expect(await throttle.charge(budget(key), 'c')).toBe(3);
      expect(await throttle.charge(budget(key), 'd')).toBe(0);

      expect(await throttle.refund(key, 'd')).toBe(false);
      expect(await throttle.charge(budget(key), 'e')).toBe(0);
      const ttl = await client.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60_000);
    });

    it('refunds a charge once, however often the refund is repeated', async () => {
      const key = fixtureKey('refund-once');
      await throttle.charge(budget(key), 'a');
      await throttle.charge(budget(key), 'b');
      await throttle.charge(budget(key), 'c');

      expect(await throttle.refund(key, 'b')).toBe(true);
      expect(await throttle.refund(key, 'b')).toBe(false);
      expect(await throttle.refund(key, 'b')).toBe(false);

      expect(await throttle.charge(budget(key), 'd')).toBe(3);
      expect(await throttle.charge(budget(key), 'e')).toBe(0);
    });

    it('never goes below zero when every charge is refunded and refunds keep coming', async () => {
      const key = fixtureKey('refund-floor');
      await throttle.charge(budget(key), 'a');

      expect(await throttle.refund(key, 'a')).toBe(true);
      expect(await throttle.refund(key, 'a')).toBe(false);
      expect(await throttle.refund(key, 'never-charged')).toBe(false);

      expect(await throttle.charge(budget(key, 1), 'b')).toBe(1);
      expect(await throttle.charge(budget(key, 1), 'c')).toBe(0);
    });

    it('keeps the window expiry through a refund to zero and the next charge', async () => {
      const key = fixtureKey('refund-ttl');
      await throttle.charge(budget(key), 'a');
      await client.pexpire(key, 5_000);

      await throttle.refund(key, 'a');
      expect(await throttle.charge(budget(key), 'b')).toBe(1);

      const ttl = await client.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5_000);
    });

    it('does not let a refund from an expired window touch the next window', async () => {
      const key = fixtureKey('refund-window');
      await throttle.charge(budget(key, 1), 'old');
      await client.pexpire(key, 50);
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(await throttle.charge(budget(key, 1), 'new')).toBe(1);

      expect(await throttle.refund(key, 'old')).toBe(false);

      expect(await throttle.charge(budget(key, 1), 'other')).toBe(0);
      expect(await throttle.refund(key, 'new')).toBe(true);
    });

    it('charges exactly the limit when charges run concurrently', async () => {
      const key = fixtureKey('charge-race');
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          throttle.charge(budget(key, 20), `t${i}`),
        ),
      );

      expect(results.filter((n) => n > 0).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
    });

    it('refunds each charge exactly once when refunds race with their retries', async () => {
      const key = fixtureKey('refund-race');
      for (let i = 0; i < 10; i++)
        await throttle.charge(budget(key, 20), `t${i}`);

      const refunded = await Promise.all(
        Array.from({ length: 30 }, (_, i) => throttle.refund(key, `t${i % 5}`)),
      );

      expect(refunded.filter(Boolean)).toHaveLength(5);
      expect(await throttle.charge(budget(key, 6), 'x')).toBe(6);
      expect(await throttle.charge(budget(key, 6), 'y')).toBe(0);
    });
  });

  it('keeps the exact count when releases race with hits', async () => {
    const key = fixtureKey('race');
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
