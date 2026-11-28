import { closeRedisAfter } from './close-redis';

const never = () => new Promise<never>(() => undefined);

const fakeClient = (quit: () => Promise<unknown>) => ({
  quit: jest.fn(quit),
  disconnect: jest.fn(),
});

describe('closeRedisAfter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('quits gracefully and disconnects after a cleanup that replies', async () => {
    const client = fakeClient(() => Promise.resolve('OK'));
    const cleanup = jest.fn().mockResolvedValue(1);

    await closeRedisAfter(client, cleanup, 1_000);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('gives up on a cleanup that never replies, still closes the client and reports the stall', async () => {
    const client = fakeClient(never);
    const outcome = closeRedisAfter(client, never, 1_000).then(
      () => null,
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(2_000);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(await outcome).toEqual(
      new Error('Redis cleanup did not reply within 1000ms'),
    );
  });

  it('keeps the cleanup error visible when quitting also fails', async () => {
    const client = fakeClient(() => Promise.reject(new Error('quit failed')));
    const cleanup = () => Promise.reject(new Error('DEL failed'));

    await expect(closeRedisAfter(client, cleanup, 1_000)).rejects.toThrow(
      'DEL failed',
    );
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes the client when only the quit never replies', async () => {
    const client = fakeClient(never);
    const outcome = closeRedisAfter(client, () => Promise.resolve(), 1_000);

    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
