import { HealthIndicatorService } from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { QueueHealthIndicator } from './queue.health';
import { ALERTING_THRESHOLDS } from '@/shared/config/alerting.config';

const fakeQueue = (
  over: Partial<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
    error: Error;
  }> = {},
) =>
  ({
    getWaitingCount: jest.fn().mockImplementation(() => {
      if (over.error) return Promise.reject(over.error);
      return Promise.resolve(over.waiting ?? 1);
    }),
    getActiveCount: jest.fn().mockResolvedValue(over.active ?? 2),
    getCompletedCount: jest.fn().mockResolvedValue(over.completed ?? 3),
    getFailedCount: jest.fn().mockResolvedValue(over.failed ?? 0),
    getDelayedCount: jest.fn().mockResolvedValue(over.delayed ?? 0),
    isPaused: jest.fn().mockResolvedValue(over.paused ?? false),
  }) as unknown as Queue;

const build = (email: Queue, story: Queue | null = null) =>
  new QueueHealthIndicator(new HealthIndicatorService(), email, story);

const CRITICAL = ALERTING_THRESHOLDS.QUEUE_FAILED_JOBS.CRITICAL;

describe('QueueHealthIndicator', () => {
  describe('isHealthy', () => {
    it('reports up with per-queue stats and totals', async () => {
      const result = await build(
        fakeQueue(),
        fakeQueue({ waiting: 4 }),
      ).isHealthy('email-queue');

      expect(result['email-queue'].status).toBe('up');
      expect(result['email-queue']).toMatchObject({
        duration: expect.stringMatching(/^\d+ms$/),
        totalWaiting: 5,
        totalActive: 4,
        totalFailed: 0,
        unhealthyQueues: [],
      });
      expect(Object.keys(result['email-queue'].queues as object)).toEqual([
        'email',
        'story',
      ]);
    });

    it('reports down with a reason when a queue is paused', async () => {
      const result = await build(fakeQueue({ paused: true })).isHealthy(
        'email-queue',
      );

      expect(result['email-queue']).toMatchObject({
        status: 'down',
        unhealthyQueues: ['email'],
        reason: 'Unhealthy queues: email',
      });
    });

    it('reports down when failed jobs reach the critical threshold', async () => {
      const result = await build(fakeQueue({ failed: CRITICAL })).isHealthy(
        'email-queue',
      );

      expect(result['email-queue'].status).toBe('down');
      expect(result['email-queue'].unhealthyQueues).toEqual(['email']);
    });

    it('stays up just below the critical threshold', async () => {
      const result = await build(fakeQueue({ failed: CRITICAL - 1 })).isHealthy(
        'email-queue',
      );

      expect(result['email-queue'].status).toBe('up');
    });

    it('reports down with the error message when redis calls fail', async () => {
      const result = await build(
        fakeQueue({ error: new Error('Connection is closed.') }),
      ).isHealthy('email-queue');

      expect(result).toEqual({
        'email-queue': {
          status: 'down',
          duration: expect.stringMatching(/^\d+ms$/),
          error: 'Connection is closed.',
        },
      });
    });
  });

  describe('checkQueue', () => {
    it('reports up with the queue stats', async () => {
      const result = await build(fakeQueue()).checkQueue('q', 'email');

      expect(result.q).toMatchObject({
        status: 'up',
        name: 'email',
        waiting: 1,
        paused: false,
      });
    });

    it('reports down for a paused queue', async () => {
      const result = await build(fakeQueue({ paused: true })).checkQueue(
        'q',
        'email',
      );

      expect(result.q).toMatchObject({
        status: 'down',
        reason: 'Queue is paused',
      });
    });

    it('reports down for too many failed jobs', async () => {
      const result = await build(fakeQueue({ failed: CRITICAL })).checkQueue(
        'q',
        'email',
      );

      expect(result.q).toMatchObject({
        status: 'down',
        reason: 'Too many failed jobs',
      });
    });

    it('reports down when the queue is not registered', async () => {
      const result = await build(fakeQueue()).checkQueue('q', 'story');

      expect(result).toEqual({
        q: { status: 'down', error: "Queue 'story' not registered" },
      });
    });

    it('reports down with the error message when the queue throws', async () => {
      const result = await build(
        fakeQueue({ error: new Error('boom') }),
      ).checkQueue('q', 'email');

      expect(result.q).toMatchObject({ status: 'down', error: 'boom' });
    });
  });
});

describe('QueueHealthIndicator with an unresponsive Redis', () => {
  // The mirror of a stopped Redis: BullMQ queues commands offline and the
  // returned promises never settle. 3000 = HEALTH_CHECK_TIMEOUT_MS.
  const hungQueue = () => {
    const never = () => new Promise<never>(() => undefined);
    return {
      getWaitingCount: jest.fn(never),
      getActiveCount: jest.fn(never),
      getCompletedCount: jest.fn(never),
      getFailedCount: jest.fn(never),
      getDelayedCount: jest.fn(never),
      isPaused: jest.fn(never),
    } as unknown as Queue;
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('isHealthy resolves down with a timeout error instead of hanging', async () => {
    let result: unknown;
    void build(hungQueue(), hungQueue())
      .isHealthy('email-queue')
      .then((r) => (result = r));

    await jest.advanceTimersByTimeAsync(3000);

    expect(result).toEqual({
      'email-queue': {
        status: 'down',
        duration: '3000ms',
        error: 'timeout after 3000ms',
      },
    });
  });

  it('checkQueue resolves down with a timeout error instead of hanging', async () => {
    let result: unknown;
    void build(hungQueue())
      .checkQueue('q', 'email')
      .then((r) => (result = r));

    await jest.advanceTimersByTimeAsync(3000);

    expect(result).toEqual({
      q: { status: 'down', duration: '3000ms', error: 'timeout after 3000ms' },
    });
  });

  it('clears its timer when the queue answers in time', async () => {
    const result = await build(fakeQueue()).isHealthy('email-queue');

    expect(result['email-queue'].status).toBe('up');
    expect(jest.getTimerCount()).toBe(0);
  });
});
