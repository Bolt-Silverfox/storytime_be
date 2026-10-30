import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GuestStoryAudioService } from './guest-story-audio.service';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { GUEST_AUDIO_THROTTLE } from '@/shared/constants/guest-audio.constants';
import { DEFAULT_VOICE } from './voice.constants';

const SESSION = '3f0c6a7e-1b2d-4c3e-8f4a-5b6c7d8e9f01';
const STORY = '24fe8886-f166-4073-a173-636873caac31';

const eagerResult = (over: Record<string, unknown> = {}) => ({
  results: [
    { index: 0, text: 'one', audioUrl: 'https://a/0.mp3' },
    { index: 1, text: 'two', audioUrl: 'https://a/1.mp3' },
  ],
  totalParagraphs: 3,
  wasTruncated: false,
  usedProvider: 'deepgram',
  eagerFailed: false,
  remainingUncached: [] as Array<{
    index: number;
    text: string;
    hash: string;
  }>,
  batchProvider: 'deepgram',
  isPremium: false,
  ...over,
});

describe('GuestStoryAudioService', () => {
  let service: GuestStoryAudioService;
  let guestSessions: { getGuestSession: jest.Mock; maskSessionId: jest.Mock };
  let stories: { getStoryById: jest.Mock };
  let tts: { batchTextToSpeechForGuest: jest.Mock };
  let queue: {
    queueBatch: jest.Mock;
    getBatchStatus: jest.Mock;
    acquireStartLock: jest.Mock;
    findInFlightBatch: jest.Mock;
  };

  beforeEach(() => {
    guestSessions = {
      getGuestSession: jest.fn().mockResolvedValue({
        sessionId: SESSION,
        uniqueStoriesRead: 1,
        readingHistory: { [STORY]: { progress: 0 } },
      }),
      maskSessionId: jest.fn((s?: string) => `masked-${s?.slice(0, 4)}`),
    };
    stories = {
      getStoryById: jest
        .fn()
        .mockResolvedValue({ id: STORY, textContent: 'one two three' }),
    };
    tts = {
      batchTextToSpeechForGuest: jest.fn().mockResolvedValue(eagerResult()),
    };
    queue = {
      queueBatch: jest.fn().mockResolvedValue('batch-1'),
      getBatchStatus: jest.fn(),
      acquireStartLock: jest
        .fn()
        .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
      findInFlightBatch: jest.fn().mockResolvedValue(null),
    };
    service = new GuestStoryAudioService(
      guestSessions as never,
      stories as never,
      tts as never,
      queue as never,
    );
  });

  describe('start', () => {
    it('full cache hit: returns clips, queues nothing', async () => {
      const res = await service.start(STORY, SESSION);
      expect(res.paragraphs).toHaveLength(2);
      expect(res.batchJobId).toBeUndefined();
      expect(res.pendingParagraphs).toBeUndefined();
      expect(queue.queueBatch).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.voiceId).toBe(DEFAULT_VOICE);
    });

    it('IGNORES a client-supplied voiceId and always uses the default voice', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      // start() has no voice parameter; the TTS facade has none either.
      // (storyId, sessionId, ip) - still no voice parameter.
      expect(service.start.length).toBe(3);
      const res = await service.start(STORY, SESSION);
      expect(tts.batchTextToSpeechForGuest.mock.calls[0]).toHaveLength(3);
      expect(queue.queueBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: DEFAULT_VOICE,
          userId: SESSION,
          isGuest: true,
          isPremium: false,
          provider: 'deepgram',
          storyId: STORY,
        }),
      );
      expect(res.voiceId).toBe(DEFAULT_VOICE);
      expect(res.batchJobId).toBe('batch-1');
      expect(res.pendingParagraphs).toBe(1);
    });

    it('outline contains ready AND pending paragraphs in order', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      const res = await service.start(STORY, SESSION);
      expect(res.outline).toEqual([
        { index: 0, text: 'one' },
        { index: 1, text: 'two' },
        { index: 2, text: 'three' },
      ]);
    });

    it('still returns eager audio when the queue is unavailable', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      queue.queueBatch.mockRejectedValue(new Error('redis down'));
      const res = await service.start(STORY, SESSION);
      expect(res.paragraphs).toHaveLength(2);
      expect(res.batchJobId).toBeUndefined();
    });

    it('rejects a malformed session id (400) before touching anything', async () => {
      await expect(service.start(STORY, 'nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.start(STORY, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(guestSessions.getGuestSession).not.toHaveBeenCalled();
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
    });

    it('rejects an expired/unknown session (401), no generation', async () => {
      guestSessions.getGuestSession.mockResolvedValue(null);
      await expect(service.start(STORY, SESSION)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
      expect(queue.queueBatch).not.toHaveBeenCalled();
    });

    it('rejects a story the session has not legitimately opened (403), no generation', async () => {
      guestSessions.getGuestSession.mockResolvedValue({
        sessionId: SESSION,
        uniqueStoriesRead: 3,
        readingHistory: { 'other-story': { progress: 0 } },
      });
      await expect(service.start(STORY, SESSION)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
      expect(queue.queueBatch).not.toHaveBeenCalled();
    });

    it('rejects unpublished / deleted / missing stories (404), no generation', async () => {
      // StoryService.getStoryById filters isPublished + isDeleted and throws.
      stories.getStoryById.mockRejectedValue(
        new NotFoundException('Story not found'),
      );
      await expect(service.start(STORY, SESSION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
    });

    it('treats a story without text as not found', async () => {
      stories.getStoryById.mockResolvedValue({ id: STORY, textContent: '' });
      await expect(service.start(STORY, SESSION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    const processing = {
      status: 'processing',
      completedParagraphs: [],
      failedParagraphs: [],
      totalQueued: 1,
    };

    it('returns the batch, scoped to the story and shared across guest sessions', async () => {
      queue.getBatchStatus.mockResolvedValue(processing);
      const res = await service.status(STORY, 'batch-1', SESSION);
      expect(queue.getBatchStatus).toHaveBeenCalledWith('batch-1', SESSION, {
        storyId: STORY,
        allowSharedGuest: true,
      });
      expect(res.status).toBe('processing');
    });

    it('404s for a batch that is missing, expired, or belongs to a different story', async () => {
      queue.getBatchStatus.mockResolvedValue(null);
      await expect(
        service.status(STORY, 'batch-1', SESSION),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('401s when the guest session no longer exists, without reading the batch', async () => {
      guestSessions.getGuestSession.mockResolvedValue(null);
      await expect(
        service.status(STORY, 'batch-1', SESSION),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(queue.getBatchStatus).not.toHaveBeenCalled();
    });

    it('400s on a malformed session id', async () => {
      await expect(
        service.status(STORY, 'batch-1', 'x'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(queue.getBatchStatus).not.toHaveBeenCalled();
    });
  });

  describe('in-flight guard', () => {
    it('holds the lock around generation+queueing and always releases it', async () => {
      const release = jest.fn().mockResolvedValue(undefined);
      queue.acquireStartLock.mockResolvedValue({ release });
      tts.batchTextToSpeechForGuest.mockRejectedValue(new Error('tts down'));
      await expect(service.start(STORY, SESSION)).rejects.toThrow('tts down');
      expect(queue.acquireStartLock).toHaveBeenCalledWith(STORY, DEFAULT_VOICE);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('reuses the batch already in flight instead of queueing a second one', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      queue.findInFlightBatch.mockResolvedValue('inflight-batch');
      const res = await service.start(STORY, SESSION);
      expect(tts.batchTextToSpeechForGuest).toHaveBeenCalledWith(
        STORY,
        expect.any(String),
        { eagerCount: 0 },
      );
      expect(queue.queueBatch).not.toHaveBeenCalled();
      expect(res.batchJobId).toBe('inflight-batch');
      expect(res.pendingParagraphs).toBe(1);
    });
  });
});

/**
 * Real GuestSessionService (in-memory) + the real queue service over a tiny
 * fake Redis, to prove the end-to-end behaviours that unit mocks cannot.
 */
describe('GuestStoryAudioService — integration with real session + queue', () => {
  const configService = {
    get: jest.fn().mockReturnValue('redis://127.0.0.1:6390'),
  };

  const makeFakeRedis = () => {
    const kv = new Map<string, string>();
    const hashes = new Map<string, Record<string, string>>();
    const sets = new Map<string, Set<string>>();
    const pipeline = () => {
      const p: Record<string, unknown> = {};
      p.hset = (k: string, f: Record<string, string> | string, v?: string) => {
        const h = hashes.get(k) ?? {};
        if (typeof f === 'string') h[f] = v as string;
        else Object.assign(h, f);
        hashes.set(k, h);
        return p;
      };
      p.sadd = (k: string, m: string) => {
        const st = sets.get(k) ?? new Set<string>();
        st.add(m);
        sets.set(k, st);
        return p;
      };
      p.srem = () => p;
      p.expire = () => p;
      p.exec = () => Promise.resolve([]);
      return p;
    };
    return {
      pipeline,
      set: jest.fn((k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && kv.has(k)) return Promise.resolve(null);
        kv.set(k, v);
        return Promise.resolve('OK');
      }),
      get: (k: string) => Promise.resolve(kv.get(k) ?? null),
      del: (...ks: string[]) => {
        ks.forEach((k) => kv.delete(k));
        return Promise.resolve(ks.length);
      },
      // release script: delete only if the token still matches
      eval: (_script: string, _n: number, key: string, token: string) => {
        if (kv.get(key) === token) {
          kv.delete(key);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      },
      hgetall: (k: string) => Promise.resolve(hashes.get(k) ?? {}),
      smembers: (k: string) => Promise.resolve([...(sets.get(k) ?? [])]),
      quit: () => Promise.resolve('OK'),
    };
  };

  const build = async () => {
    const { GuestSessionService } =
      await import('@/guest/guest-session.service');
    const { TtsBatchQueueService } =
      await import('./queue/tts-batch-queue.service');
    const sessions = new GuestSessionService(
      configService as never,
      {} as never,
    );
    const bullQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const redis = makeFakeRedis();
    const queue = new TtsBatchQueueService(bullQueue as never, redis as never);
    return { sessions, bullQueue, redis, queue };
  };

  const PARAS = ['p0', 'p1', 'p2', 'p3', 'p4'].map((text, index) => ({
    index,
    text,
    hash: `h${index}`,
  }));

  it('progress POST on an unopened story, then audio start => 403, no generation', async () => {
    const { sessions, queue } = await build();
    const { sessionId } = await sessions.createGuestSession();
    const generate = jest.fn();
    const svc = new GuestStoryAudioService(
      sessions,
      {
        getStoryById: jest
          .fn()
          .mockResolvedValue({ id: STORY, textContent: 'x y z' }),
      } as never,
      { batchTextToSpeechForGuest: generate } as never,
      queue,
    );

    await sessions.updateGuestProgress(sessionId, STORY, 60);

    await expect(svc.start(STORY, sessionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('two parallel starts for the same (story, voice) generate each paragraph once and share one batch', async () => {
    const { sessions, bullQueue, queue } = await build();
    const a = await sessions.createGuestSession();
    const b = await sessions.createGuestSession();
    await sessions.recordNewStoryAccess(a.sessionId, STORY);
    await sessions.recordNewStoryAccess(b.sessionId, STORY);

    // Fake TTS layer: a paragraph is "cached" once generated. Generation takes
    // a moment so the second start genuinely overlaps the first.
    const cached = new Set<number>();
    const generatedCount = new Map<number, number>();
    const tts = {
      batchTextToSpeechForGuest: jest.fn(
        async (_s: string, _t: string, o: { eagerCount: number }) => {
          const uncached = PARAS.filter((p) => !cached.has(p.index));
          const eager = uncached.slice(0, o.eagerCount);
          await new Promise((r) => setTimeout(r, 30));
          for (const p of eager) {
            cached.add(p.index);
            generatedCount.set(p.index, (generatedCount.get(p.index) ?? 0) + 1);
          }
          return eagerResult({
            results: PARAS.filter((p) => cached.has(p.index)).map((p) => ({
              index: p.index,
              text: p.text,
              audioUrl: `https://a/${p.index}.mp3`,
            })),
            totalParagraphs: PARAS.length,
            remainingUncached: uncached.slice(o.eagerCount),
          });
        },
      ),
    };
    const svc = new GuestStoryAudioService(
      sessions,
      {
        getStoryById: jest
          .fn()
          .mockResolvedValue({ id: STORY, textContent: 'x y z' }),
      } as never,
      tts as never,
      queue,
    );

    const [r1, r2] = await Promise.all([
      svc.start(STORY, a.sessionId),
      svc.start(STORY, b.sessionId),
    ]);

    expect([...generatedCount.values()]).toEqual([1, 1]); // paragraphs 0 and 1, once each
    expect(bullQueue.add).toHaveBeenCalledTimes(1);
    expect(r1.batchJobId).toBeDefined();
    expect(r2.batchJobId).toBe(r1.batchJobId);

    // The second session can poll the shared batch (same story only).
    await expect(
      svc.status(STORY, r1.batchJobId as string, b.sessionId),
    ).resolves.toEqual(expect.objectContaining({ status: 'processing' }));
    await expect(
      svc.status(
        '11111111-1111-4111-8111-111111111111',
        r1.batchJobId as string,
        b.sessionId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails open when Redis errors: still generates, never throws from the guard', async () => {
    const { sessions, queue, redis } = await build();
    const a = await sessions.createGuestSession();
    await sessions.recordNewStoryAccess(a.sessionId, STORY);
    redis.set.mockRejectedValue(new Error('redis down'));
    (redis as { get: unknown }).get = () =>
      Promise.reject(new Error('redis down'));
    const generate = jest.fn().mockResolvedValue(eagerResult());
    const svc = new GuestStoryAudioService(
      sessions,
      {
        getStoryById: jest
          .fn()
          .mockResolvedValue({ id: STORY, textContent: 'x y z' }),
      } as never,
      { batchTextToSpeechForGuest: generate } as never,
      queue,
    );
    const res = await svc.start(STORY, a.sessionId);
    expect(res.statusCode).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('GuestStoryAudioService — shared hourly IP limit', () => {
  let service: GuestStoryAudioService;
  let guestSessions: unknown;
  let stories: unknown;
  let tts: unknown;
  let queue: unknown;
  const origEnv = process.env.NODE_ENV;
  afterAll(() => {
    process.env.NODE_ENV = origEnv;
  });
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    guestSessions = {
      getGuestSession: jest.fn().mockResolvedValue({
        sessionId: SESSION,
        uniqueStoriesRead: 1,
        readingHistory: { [STORY]: { progress: 0 } },
      }),
      maskSessionId: jest.fn((s?: string) => `masked-${s?.slice(0, 4)}`),
    };
    stories = {
      getStoryById: jest
        .fn()
        .mockResolvedValue({ id: STORY, textContent: 'one two three' }),
    };
    tts = {
      batchTextToSpeechForGuest: jest.fn().mockResolvedValue(eagerResult()),
    };
    queue = {
      queueBatch: jest.fn().mockResolvedValue('batch-1'),
      acquireStartLock: jest
        .fn()
        .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
      findInFlightBatch: jest.fn().mockResolvedValue(null),
    };
  });
  describe('shared hourly per-IP limit', () => {
    let storage: ThrottlerStorageService;
    beforeEach(() => {
      storage = new ThrottlerStorageService();
      service = new GuestStoryAudioService(
        guestSessions as never,
        stories as never,
        tts as never,
        queue as never,
        storage,
      );
    });
    afterEach(() => storage.onApplicationShutdown?.());

    it('rejects the 61st start from one IP within the hour (429), other IPs unaffected', async () => {
      const limit = GUEST_AUDIO_THROTTLE.start.ipPerHour.limit;
      for (let i = 0; i < limit; i++) {
        await service.start(STORY, SESSION, '9.9.9.9');
      }
      await expect(service.start(STORY, SESSION, '9.9.9.9')).rejects.toThrow(
        ThrottlerException,
      );
      await expect(
        service.start(STORY, SESSION, '8.8.8.8'),
      ).resolves.toBeDefined();
    });

    it('shares ONE counter regardless of which route calls start (same key)', async () => {
      const limit = GUEST_AUDIO_THROTTLE.start.ipPerHour.limit;
      // alternate callers (guest route / batch route) - both just call start(ip)
      for (let i = 0; i < limit; i++) {
        await service.start(STORY, SESSION, '7.7.7.7');
      }
      expect(storage.storage.size).toBe(1);
      await expect(service.start(STORY, SESSION, '7.7.7.7')).rejects.toThrow(
        ThrottlerException,
      );
    });

    it('does nothing when no IP is available (fails open)', async () => {
      await expect(
        service.start(STORY, SESSION, undefined),
      ).resolves.toBeDefined();
    });

    it('fails open if the throttler storage errors', async () => {
      service = new GuestStoryAudioService(
        guestSessions as never,
        stories as never,
        tts as never,
        queue as never,
        { increment: jest.fn().mockRejectedValue(new Error('x')) },
      );
      await expect(
        service.start(STORY, SESSION, '1.1.1.1'),
      ).resolves.toBeDefined();
    });
  });
});
