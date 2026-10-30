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

  it('fails open (never throws) when the Redis lock errors', async () => {
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
    ).resolves.toEqual({ recorded: true });
  });

  it('takes and releases a Redis lock keyed by session id when Redis-backed', async () => {
    const service = build();
    const set = jest.fn().mockResolvedValue('OK');
    const evalFn = jest.fn().mockResolvedValue(1);
    (service as unknown as { redisStore: unknown }).redisStore = {
      client: { isReady: true, set, eval: evalFn },
    };
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-z');

    expect(set).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      expect.any(String),
      expect.objectContaining({ NX: true }),
    );
    expect(evalFn).toHaveBeenCalledTimes(1);
  });
});
