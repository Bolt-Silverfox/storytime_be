import { TtsBatchQueueService } from './tts-batch-queue.service';
import { TtsBatchJobData } from './tts-batch-job.interface';

const makePipeline = () => {
  const pipeline = {
    hset: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  return pipeline;
};

describe('TtsBatchQueueService', () => {
  let queue: { add: jest.Mock };
  let redis: { pipeline: jest.Mock; del: jest.Mock; quit: jest.Mock };
  let service: TtsBatchQueueService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    redis = {
      pipeline: jest.fn(() => makePipeline()),
      del: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    service = new TtsBatchQueueService(queue as never, redis as never);
  });

  const original: TtsBatchJobData = {
    batchJobId: 'batch-abc',
    storyId: 'story-1',
    voiceId: 'voice-1',
    userId: 'user-1',
    isPremium: false,
    provider: 'elevenlabs',
    paragraphs: [{ index: 0, text: 'hi', hash: 'h0' }],
    totalParagraphs: 1,
  };

  it('builds a retry job id without the reserved BullMQ colon separator', async () => {
    await service.queueRetryBatch(original, original.paragraphs, 1);

    const addOptions = queue.add.mock.calls[0][2];
    expect(addOptions.jobId).not.toContain(':');
    expect(addOptions.jobId).toBe('batch-abc-retry-1');
  });

  describe('start lock (in-flight guard)', () => {
    type R = typeof redis & {
      set: jest.Mock;
      get: jest.Mock;
      eval: jest.Mock;
      hgetall: jest.Mock;
    };
    const r = () => redis as R;
    beforeEach(() => {
      r().set = jest.fn().mockResolvedValue('OK');
      r().get = jest.fn().mockResolvedValue(null);
      r().eval = jest.fn().mockResolvedValue(1);
      r().hgetall = jest.fn().mockResolvedValue({});
    });

    it('acquires with SET NX EX and releases only its own token', async () => {
      const lock = await service.acquireStartLock('story-1', 'default');
      const [key, token, ex, ttl, nx] = r().set.mock.calls[0];
      expect(key).toBe('tts-batch:start-lock:story-1:default');
      expect([ex, nx]).toEqual(['EX', 'NX']);
      expect(ttl).toBeGreaterThan(0);
      await lock.release();
      expect(r().eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        key,
        token,
      );
    });

    it('waits for a held lock to be released, then acquires', async () => {
      r()
        .set.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');
      await service.acquireStartLock('story-1', 'default', {
        waitMs: 1000,
        pollMs: 1,
      });
      expect(r().set).toHaveBeenCalledTimes(3);
    });

    it('fails open (no throw, no-op release) when Redis errors', async () => {
      r().set.mockRejectedValue(new Error('redis down'));
      const lock = await service.acquireStartLock('story-1', 'default');
      await expect(lock.release()).resolves.toBeUndefined();
      expect(r().eval).not.toHaveBeenCalled();
    });

    it('fails open after the wait budget if the lock is never released', async () => {
      r().set.mockResolvedValue(null);
      const lock = await service.acquireStartLock('story-1', 'default', {
        waitMs: 20,
        pollMs: 5,
      });
      await expect(lock.release()).resolves.toBeUndefined();
    });

    it('findInFlightBatch returns the id only while that batch is processing', async () => {
      r().get.mockResolvedValue('b-1');
      r().hgetall.mockResolvedValue({ status: 'processing' });
      await expect(service.findInFlightBatch('s', 'default')).resolves.toBe(
        'b-1',
      );
      r().hgetall.mockResolvedValue({ status: 'completed' });
      await expect(
        service.findInFlightBatch('s', 'default'),
      ).resolves.toBeNull();
      r().get.mockRejectedValue(new Error('redis down'));
      await expect(
        service.findInFlightBatch('s', 'default'),
      ).resolves.toBeNull();
    });

    it('in-flight marker is audience-scoped: a paid batch is never handed to a guest; guest batches still join', async () => {
      const kv = new Map<string, string>();
      const meta = new Map<string, Record<string, string>>();
      const pl = () => {
        const p: Record<string, unknown> = {};
        p.hset = (k: string, f: Record<string, string> | string) => {
          if (typeof f !== 'string') meta.set(k, f);
          return p;
        };
        p.sadd = () => p;
        p.expire = () => p;
        p.exec = () => Promise.resolve([]);
        return p;
      };
      r().pipeline = jest.fn(pl);
      r().set = jest.fn((k: string, v: string) => {
        kv.set(k, v);
        return Promise.resolve('OK');
      });
      r().get = jest.fn((k: string) => Promise.resolve(kv.get(k) ?? null));
      r().hgetall = jest.fn((k: string) => Promise.resolve(meta.get(k) ?? {}));
      const base = {
        storyId: 'story-1',
        voiceId: 'default',
        userId: 'u',
        isPremium: false,
        provider: 'deepgram' as const,
        paragraphs: [{ index: 0, text: 'a', hash: 'h' }],
        totalParagraphs: 1,
      };

      await service.queueBatch({
        ...base,
        voiceId: 'default',
        userId: 'paid-user',
      });
      await expect(
        service.findInFlightBatch('story-1', 'default'),
      ).resolves.toBeNull();

      const g1 = await service.queueBatch({
        ...base,
        userId: 'g1',
        isGuest: true,
      });
      await expect(
        service.findInFlightBatch('story-1', 'default'),
      ).resolves.toBe(g1);
      // a later paid batch must not displace the guest marker
      await service.queueBatch({ ...base, userId: 'paid-2' });
      await expect(
        service.findInFlightBatch('story-1', 'default'),
      ).resolves.toBe(g1);
    });

    it('getBatchStatus: story mismatch -> null; guest batches are readable by other guests only when opted in', async () => {
      r().hgetall.mockImplementation((k: string) =>
        Promise.resolve(
          k.endsWith(':meta')
            ? {
                status: 'processing',
                totalQueued: '1',
                userId: 'guest-A',
                storyId: 'story-1',
                isGuest: '1',
              }
            : {},
        ),
      );
      (redis as { smembers?: jest.Mock }).smembers = jest
        .fn()
        .mockResolvedValue([]);
      expect(
        await service.getBatchStatus('b', 'guest-B', { storyId: 'story-2' }),
      ).toBeNull();
      expect(await service.getBatchStatus('b', 'guest-B')).toBeNull();
      expect(
        await service.getBatchStatus('b', 'guest-B', {
          storyId: 'story-1',
          allowSharedGuest: true,
        }),
      ).not.toBeNull();
    });
  });
});
