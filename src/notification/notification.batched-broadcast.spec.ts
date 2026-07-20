import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { EmailQueueService } from './queue/email-queue.service';
import { PushProvider } from './providers/push.provider';
import { PushQueueService } from './queue/push-queue.service';

/**
 * Focused unit tests for the batched (staggered) broadcast:
 * chunking math, per-batch delays, token de-duplication, and empty-device case.
 */
describe('NotificationService - broadcastBatchedToAllDevices', () => {
  let service: NotificationService;

  const mockConfigService = { get: jest.fn().mockReturnValue(undefined) };

  const mockPrismaService = {
    deviceToken: {
      findMany: jest.fn(),
    },
  };

  const mockPushQueueService = {
    queueTokenBatch: jest.fn().mockResolvedValue({ queued: true, jobId: 'x' }),
  };

  const noop = {};

  /**
   * Configure deviceToken.findMany to page through the given token list using
   * the same cursor pagination the service uses (DB page size 1000).
   */
  function stubDevicePages(tokens: string[]): void {
    const PAGE = 1000;
    mockPrismaService.deviceToken.findMany.mockImplementation(
      (args: { cursor?: { id: string }; take: number }) => {
        const startIndex = args.cursor
          ? tokens.findIndex((_, i) => `id-${i}` === args.cursor!.id) + 1
          : 0;
        const page = tokens
          .slice(startIndex, startIndex + PAGE)
          .map((token, offset) => ({ id: `id-${startIndex + offset}`, token }));
        return Promise.resolve(page);
      },
    );
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InAppProvider, useValue: noop },
        { provide: EmailProvider, useValue: noop },
        { provide: EmailQueueService, useValue: noop },
        { provide: PushProvider, useValue: noop },
        { provide: PushQueueService, useValue: mockPushQueueService },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    jest.clearAllMocks();
    mockPushQueueService.queueTokenBatch.mockResolvedValue({
      queued: true,
      jobId: 'x',
    });
  });

  it('splits 1250 tokens into 3 batches with delays 0, interval, 2*interval', async () => {
    const tokens = Array.from({ length: 1250 }, (_, i) => `token-${i}`);
    stubDevicePages(tokens);

    const result = await service.broadcastBatchedToAllDevices({
      title: 'Hi',
      body: 'There',
      batchSize: 500,
      intervalSeconds: 120,
    });

    expect(result).toEqual({
      totalDevices: 1250,
      batches: 3,
      batchSize: 500,
      estimatedDurationSeconds: 240, // (3 - 1) * 120
    });

    expect(mockPushQueueService.queueTokenBatch).toHaveBeenCalledTimes(3);

    const calls = mockPushQueueService.queueTokenBatch.mock.calls;
    // Chunk sizes: 500, 500, 250
    expect(calls[0][0]).toHaveLength(500);
    expect(calls[1][0]).toHaveLength(500);
    expect(calls[2][0]).toHaveLength(250);

    // Delay is the 5th positional arg (tokens, title, body, data, delay).
    const delays = calls.map((c) => c[4] as number).sort((a, b) => a - b);
    expect(delays).toEqual([0, 120_000, 240_000]);

    // Every token is delivered exactly once, no gaps/overlaps.
    const delivered = calls.flatMap((c) => c[0] as string[]);
    expect(delivered).toHaveLength(1250);
    expect(new Set(delivered).size).toBe(1250);
  });

  it('de-duplicates tokens before chunking', async () => {
    // 600 unique tokens, each duplicated once -> 1200 rows, but only 600 pushes.
    const unique = Array.from({ length: 600 }, (_, i) => `dup-${i}`);
    const withDupes = [...unique, ...unique];
    stubDevicePages(withDupes);

    const result = await service.broadcastBatchedToAllDevices({
      title: 'Hi',
      body: 'There',
      batchSize: 500,
      intervalSeconds: 60,
    });

    expect(result.totalDevices).toBe(600);
    expect(result.batches).toBe(2); // ceil(600 / 500)

    const delivered = mockPushQueueService.queueTokenBatch.mock.calls.flatMap(
      (c) => c[0] as string[],
    );
    expect(delivered).toHaveLength(600);
    expect(new Set(delivered).size).toBe(600);
  });

  it('returns batches:0 and queues nothing when there are no devices', async () => {
    stubDevicePages([]);
    const warnSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    const result = await service.broadcastBatchedToAllDevices({
      title: 'Hi',
      body: 'There',
    });

    expect(result).toEqual({
      totalDevices: 0,
      batches: 0,
      batchSize: 500,
      estimatedDurationSeconds: 0,
    });
    expect(mockPushQueueService.queueTokenBatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws when a batch fails to enqueue', async () => {
    const tokens = Array.from({ length: 600 }, (_, i) => `t-${i}`);
    stubDevicePages(tokens);
    mockPushQueueService.queueTokenBatch
      .mockResolvedValueOnce({ queued: true, jobId: 'a' })
      .mockResolvedValueOnce({
        queued: false,
        jobId: 'b',
        error: 'redis down',
      });

    await expect(
      service.broadcastBatchedToAllDevices({
        title: 'Hi',
        body: 'There',
        batchSize: 500,
        intervalSeconds: 0,
      }),
    ).rejects.toThrow(/failed to enqueue/i);
  });

  it('falls back to defaults for non-finite inputs', async () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `t-${i}`);
    stubDevicePages(tokens);

    const result = await service.broadcastBatchedToAllDevices({
      title: 'Hi',
      body: 'There',
      batchSize: Number.NaN,
      intervalSeconds: Number.POSITIVE_INFINITY,
    });

    expect(result.batchSize).toBe(500);
    expect(result.batches).toBe(1);
    expect(result.estimatedDurationSeconds).toBe(0);
  });

  it('clamps batchSize to the 500 FCM multicast limit', async () => {
    const tokens = Array.from({ length: 600 }, (_, i) => `t-${i}`);
    stubDevicePages(tokens);

    const result = await service.broadcastBatchedToAllDevices({
      title: 'Hi',
      body: 'There',
      batchSize: 100_000, // absurd, must clamp to 500
      intervalSeconds: 0,
    });

    expect(result.batchSize).toBe(500);
    expect(result.batches).toBe(2);
    expect(result.estimatedDurationSeconds).toBe(0);
    // All delays are 0 when interval is 0.
    const delays = mockPushQueueService.queueTokenBatch.mock.calls.map(
      (c) => c[4] as number,
    );
    expect(delays).toEqual([0, 0]);
  });
});
