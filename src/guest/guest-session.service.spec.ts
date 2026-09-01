import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GuestSessionService } from './guest-session.service';
import type { IGuestRepository } from './repositories/guest.repository.interface';

/**
 * Regression test for the guest-session keyv fallback.
 *
 * Previously, when Redis was unreachable the constructor's `error` handler
 * swapped `this.keyv` to a *fresh empty* in-memory store, so the value written
 * by `set` was lost and the immediate read-back returned undefined — surfacing
 * as a 500 "Failed to create guest session". The in-memory fallback must work.
 */
describe('GuestSessionService — in-memory fallback', () => {
  // Point at an unreachable Redis so the service must use the in-memory store.
  const configService = {
    get: jest.fn().mockReturnValue('redis://127.0.0.1:6390'),
  } as unknown as ConfigService;
  const guestRepository = {} as unknown as IGuestRepository;

  it('createGuestSession stores and reads back without Redis', async () => {
    const service = new GuestSessionService(configService, guestRepository);
    // Intentionally do NOT call onModuleInit -> the service stays on its
    // default in-memory store (the fallback path).

    const session = await service.createGuestSession();
    expect(session.sessionId).toBeTruthy();

    const fetched = await service.getGuestSession(session.sessionId);
    expect(fetched).not.toBeNull();
    expect(fetched?.sessionId).toBe(session.sessionId);
  });

  it('genuine cache miss (in-memory, no Redis) returns null, not 503', async () => {
    const service = new GuestSessionService(configService, guestRepository);
    // No redisStore set -> storage is the healthy in-memory store; an absent
    // key is a real miss and must surface as null (-> 401 upstream).
    await expect(service.getGuestSession('does-not-exist')).resolves.toBeNull();
  });
});

/**
 * #453: when the guest-session store is Redis-backed and Redis is unhealthy,
 * a lookup/write that comes back empty must NOT be reported as a genuine miss
 * (which surfaces as a misleading 401 "session expired"). It must throw
 * ServiceUnavailableException (503) so the caller can distinguish a storage
 * outage from an actually-absent session.
 */
describe('GuestSessionService — Redis outage surfaces 503, not 401', () => {
  const configService = {
    get: jest.fn().mockReturnValue('redis://127.0.0.1:6390'),
  } as unknown as ConfigService;
  const guestRepository = {} as unknown as IGuestRepository;

  // Build a service pinned to a Redis-backed store whose node-redis client
  // reports the given readiness, and whose get/set behave as stubbed.
  function redisBackedService(opts: {
    isReady: boolean;
    get?: () => Promise<unknown>;
    set?: () => Promise<unknown>;
  }): GuestSessionService {
    const service = new GuestSessionService(configService, guestRepository);
    const keyvStub = {
      get: opts.get ?? (async () => undefined),
      set: opts.set ?? (async () => true),
      delete: async () => true,
      on: () => keyvStub,
    };
    // Simulate the Redis-backed state onModuleInit would have established.
    (service as unknown as { keyv: unknown }).keyv = keyvStub;
    (service as unknown as { redisStore: unknown }).redisStore = {
      client: { isReady: opts.isReady },
    };
    return service;
  }

  it('read failure while Redis is down throws 503', async () => {
    const service = redisBackedService({ isReady: false });
    await expect(service.getGuestSession('sid')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('write failure while Redis is down throws 503 (not 500)', async () => {
    const service = redisBackedService({ isReady: false });
    await expect(service.createGuestSession()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('write path: session read succeeds but Redis drops during set -> 503', async () => {
    // get returns a real session (read ok), but the client is not ready, so
    // the post-set durability guard must reject with 503.
    const existing = {
      sessionId: 'sid',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      readingHistory: {},
      uniqueStoriesRead: 0,
    };
    const service = redisBackedService({
      isReady: false,
      get: async () => existing,
    });
    await expect(
      service.updateGuestProgress('sid', 'story-1', 50),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('recovered Redis: an absent key is a genuine miss -> null', async () => {
    const service = redisBackedService({ isReady: true });
    await expect(service.getGuestSession('sid')).resolves.toBeNull();
  });

  // isReady only flips once the socket is known-down. An in-flight command can
  // still reject (error reply, timeout) while isReady is true — throwOnErrors
  // makes get/set reject, and that reject must map to 503, not a miss/success.
  it('read that rejects while client still reports ready -> 503', async () => {
    const service = redisBackedService({
      isReady: true,
      get: async () => {
        throw new Error('READONLY You can-t write against a read only replica.');
      },
    });
    await expect(service.getGuestSession('sid')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('write that rejects while client still reports ready -> 503', async () => {
    const existing = {
      sessionId: 'sid',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      readingHistory: {},
      uniqueStoriesRead: 0,
    };
    const service = redisBackedService({
      isReady: true,
      get: async () => existing,
      set: async () => {
        throw new Error('Connection timeout');
      },
    });
    await expect(
      service.updateGuestProgress('sid', 'story-1', 50),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
