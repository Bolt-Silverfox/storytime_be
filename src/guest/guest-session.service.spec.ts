import { EventEmitter } from 'node:events';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GuestSessionService } from './guest-session.service';
import type { IGuestRepository } from './repositories/guest.repository.interface';

// Replace KeyvRedis with an in-memory EventEmitter-backed store that also
// exposes a raw `client` EventEmitter (mirroring node-redis). Only the tests
// that call onModuleInit construct it; the others never touch this module.
jest.mock('@keyv/redis', () => {
  class FakeKeyvRedis extends EventEmitter {
    readonly client = new EventEmitter();
    private readonly data = new Map<string, unknown>();
    get(key: string): Promise<unknown> {
      return Promise.resolve(this.data.get(key));
    }
    set(key: string, value: unknown): Promise<boolean> {
      this.data.set(key, value);
      return Promise.resolve(true);
    }
    delete(key: string): Promise<boolean> {
      return Promise.resolve(this.data.delete(key));
    }
    clear(): Promise<void> {
      this.data.clear();
      return Promise.resolve();
    }
    disconnect(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { __esModule: true, default: FakeKeyvRedis, KeyvRedis: FakeKeyvRedis };
});

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
        throw new Error(
          'READONLY You can-t write against a read only replica.',
        );
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

  // disableOfflineQueue:true makes node-redis reject a command issued while the
  // socket is down (ClientOfflineError) instead of queuing it until reconnect.
  // That reject must surface as a fast 503 rather than a hang or a false miss.
  it('read rejected as offline (client not ready) -> 503, not a hang', async () => {
    const service = redisBackedService({
      isReady: false,
      get: async () => {
        throw new Error('The client is offline');
      },
    });
    await expect(service.getGuestSession('sid')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

/**
 * Sentry STORYTIME-BE-2: `SocketClosedUnexpectedlyError` from node-redis was
 * an *unhandled* 'error' event -> uncaught exception -> process crash / PM2
 * restart. @keyv/redis does not forward the raw client's 'error' event, so the
 * service must attach its own listener on `store.client`.
 */
describe('GuestSessionService — raw node-redis client errors are handled', () => {
  const configService = {
    get: jest.fn().mockReturnValue('redis://127.0.0.1:6390'),
  } as unknown as ConfigService;
  const guestRepository = {} as unknown as IGuestRepository;

  it("'error' on store.client is logged at warn and does not throw", async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const service = new GuestSessionService(configService, guestRepository);
      await service.onModuleInit();

      const store = (
        service as unknown as {
          redisStore?: EventEmitter & {
            client: EventEmitter;
          };
        }
      ).redisStore;
      // Health-check round-tripped against the fake store -> Redis-backed.
      expect(store).toBeDefined();
      expect(store!.client.listenerCount('error')).toBeGreaterThan(0);

      const socketErr = new Error('Socket closed unexpectedly');
      // With no listener EventEmitter#emit('error') throws synchronously —
      // exactly what surfaced as the fatal uncaught exception in Sentry.
      expect(() => store!.client.emit('error', socketErr)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Socket closed unexpectedly'),
      );

      // Store-level errors keep their own listener too.
      expect(() => store!.emit('error', new Error('op failed'))).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});
