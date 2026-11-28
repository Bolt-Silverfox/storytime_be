import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GUEST_STORY_LIMIT,
  GuestSessionService,
} from './guest-session.service';
import type { IGuestRepository } from './repositories/guest.repository.interface';

/**
 * Stateful fake of the Keyv JSON blob. get() hands back a *copy* and yields to
 * the event loop first, so concurrent read-modify-write cycles interleave
 * exactly like two requests hitting Redis.
 */
class DelayedKeyv {
  readonly data = new Map<string, string>();
  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    await new Promise((r) => setTimeout(r, 5));
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  async set(key: string, value: unknown): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 1));
    this.data.set(key, JSON.stringify(value));
    return true;
  }
  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.data.delete(key));
  }
  _getKeyPrefix(key: string): string {
    return key;
  }
  serializeData(data: unknown): Promise<string> {
    return Promise.resolve(JSON.stringify(data));
  }
}

const build = () => {
  const service = new GuestSessionService(
    { get: jest.fn().mockReturnValue('redis://x') } as unknown as ConfigService,
    {} as unknown as IGuestRepository,
  );
  (service as unknown as { keyv: unknown }).keyv = new DelayedKeyv();
  return service;
};

describe('GuestSessionService — concurrent read-modify-write', () => {
  it('a progress POST racing recordNewStoryAccess does not wipe the new history entry', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-x');

    const [, rec] = await Promise.all([
      service.updateGuestProgress(sessionId, 'story-x', 50),
      service.recordNewStoryAccess(sessionId, 'story-y'),
    ]);

    expect(rec).toEqual({ recorded: true });
    const history = await service.getGuestReadingHistory(sessionId);
    expect(Object.keys(history ?? {}).sort()).toEqual(['story-x', 'story-y']);
    expect(history?.['story-x'].progress).toBe(50);
    expect((await service.getGuestSession(sessionId))?.uniqueStoriesRead).toBe(
      2,
    );
  });

  it('parallel first-time opens cannot pass the unique-story quota', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();

    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) =>
        service.recordNewStoryAccess(sessionId, id),
      ),
    );

    expect(results.filter((r) => r.recorded)).toHaveLength(GUEST_STORY_LIMIT);
    const session = await service.getGuestSession(sessionId);
    expect(session?.uniqueStoriesRead).toBe(GUEST_STORY_LIMIT);
    expect(Object.keys(session?.readingHistory ?? {})).toHaveLength(
      GUEST_STORY_LIMIT,
    );
  });

  it('refuses to save a new story with a 503 when the Redis lock errors, and saves nothing', async () => {
    const service = build();
    (service as unknown as { redisStore: unknown }).redisStore = {
      client: {
        isReady: true,
        set: jest.fn().mockRejectedValue(new Error('redis down')),
        eval: jest.fn().mockRejectedValue(new Error('redis down')),
      },
    };
    const { sessionId } = await service.createGuestSession();
    await expect(
      service.recordNewStoryAccess(sessionId, 'story-z'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await service.getGuestReadingHistory(sessionId)).toEqual({});
  });

  it('refuses to save progress with a 503 when the Redis lock errors, and saves nothing', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-z');
    (service as unknown as { redisStore: unknown }).redisStore = {
      client: {
        isReady: true,
        set: jest.fn().mockRejectedValue(new Error('redis down')),
        eval: jest.fn().mockRejectedValue(new Error('redis down')),
      },
    };
    await expect(
      service.updateGuestProgress(sessionId, 'story-z', 40),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(
      (await service.getGuestReadingHistory(sessionId))?.['story-z'].progress,
    ).toBe(0);
  });

  it('refuses to save progress with a 503 instead of waiting forever on a never-settling predecessor', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-z');
    jest.useFakeTimers();
    try {
      const chains = (
        service as unknown as { sessionChains: Map<string, Promise<void>> }
      ).sessionChains;
      chains.set(sessionId, new Promise<void>(() => undefined));

      const p = service.updateGuestProgress(sessionId, 'story-z', 40);
      p.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(10_000);
      await expect(p).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      jest.useRealTimers();
    }
    expect(
      (await service.getGuestReadingHistory(sessionId))?.['story-z'].progress,
    ).toBe(0);
  });

  it('takes a Redis lock keyed by session id, saves only while holding it, then releases it', async () => {
    const service = build();
    const set = jest.fn().mockResolvedValue('OK');
    const evalFn = jest.fn().mockResolvedValue(1);
    (service as unknown as { redisStore: unknown }).redisStore = {
      client: { isReady: true, set, eval: evalFn },
      createKeyPrefix: (key: string) => key,
      namespace: undefined,
    };
    const { sessionId } = await service.createGuestSession();
    await expect(
      service.recordNewStoryAccess(sessionId, 'story-z'),
    ).resolves.toEqual({ recorded: true });

    expect(set).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      expect.any(String),
      expect.objectContaining({ NX: true }),
    );
    const [lockKey, token] = set.mock.calls[0] as [string, string];
    expect(evalFn).toHaveBeenCalledTimes(2);
    const [saveScript, save] = evalFn.mock.calls[0] as [
      string,
      { keys: string[]; arguments: string[] },
    ];
    expect(saveScript).toContain("'set', KEYS[2]");
    expect(save.keys).toEqual([lockKey, `guest:session:${sessionId}`]);
    expect(save.arguments[0]).toBe(token);
    expect(JSON.parse(save.arguments[1]).value.readingHistory).toHaveProperty(
      'story-z',
    );
    expect(evalFn.mock.calls[1][1]).toEqual({
      keys: [lockKey],
      arguments: [token],
    });
  });

  it('answers 503 when the lock expired before the save', async () => {
    const service = build();
    (service as unknown as { redisStore: unknown }).redisStore = {
      client: {
        isReady: true,
        set: jest.fn().mockResolvedValue('OK'),
        eval: jest.fn().mockResolvedValue(0),
      },
      createKeyPrefix: (key: string) => key,
      namespace: undefined,
    };
    const { sessionId } = await service.createGuestSession();

    await expect(
      service.recordNewStoryAccess(sessionId, 'story-z'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers 503 instead of waiting forever on a never-settling predecessor and leaks no map entry', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    jest.useFakeTimers();
    try {
      const chains = (
        service as unknown as { sessionChains: Map<string, Promise<void>> }
      ).sessionChains;
      chains.set(sessionId, new Promise<void>(() => undefined));

      const p = service.recordNewStoryAccess(sessionId, 'story-q');
      p.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(10_000);
      await expect(p).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(chains.has(sessionId)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('GuestSessionService.deleteGuestSessionIfHistoryIs', () => {
  it('deletes the session when its history still lists exactly the copied stories', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-x');

    await expect(
      service.deleteGuestSessionIfHistoryIs(sessionId, ['story-x']),
    ).resolves.toEqual({ deleted: true });

    expect(await service.getGuestSession(sessionId)).toBeNull();
  });

  it('keeps the session and returns the current history when a story was opened after the copy', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-x');
    await service.recordNewStoryAccess(sessionId, 'story-y');

    const result = await service.deleteGuestSessionIfHistoryIs(sessionId, [
      'story-x',
    ]);

    expect(result.deleted).toBe(false);
    expect(Object.keys(result.deleted ? {} : result.history).sort()).toEqual([
      'story-x',
      'story-y',
    ]);
    expect(await service.getGuestSession(sessionId)).not.toBeNull();
  });

  it('waits for an open already in flight and keeps the story it saved', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-x');

    const [rec, result] = await Promise.all([
      service.recordNewStoryAccess(sessionId, 'story-y'),
      service.deleteGuestSessionIfHistoryIs(sessionId, ['story-x']),
    ]);

    expect(rec).toEqual({ recorded: true });
    expect(result.deleted).toBe(false);
    expect(
      (await service.getGuestSession(sessionId))?.readingHistory['story-y'],
    ).toBeDefined();
  });
});

describe('GuestSessionService.deleteGuestSessionIfHistoryIs without the lock', () => {
  it('keeps the session when it cannot hold the session lock', async () => {
    const service = build();
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-x');
    jest.useFakeTimers();
    try {
      const chains = (
        service as unknown as { sessionChains: Map<string, Promise<void>> }
      ).sessionChains;
      chains.set(sessionId, new Promise<void>(() => undefined));

      const result = service.deleteGuestSessionIfHistoryIs(sessionId, [
        'story-x',
      ]);
      await jest.advanceTimersByTimeAsync(10_000);

      expect((await result).deleted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
    expect(await service.getGuestSession(sessionId)).not.toBeNull();
  });
});
