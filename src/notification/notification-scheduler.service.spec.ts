import { Test, TestingModule } from '@nestjs/testing';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_REDIS } from './notification-redis.provider';

const mockPrismaService = {
  subscription: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  userStoryProgress: { findMany: jest.fn() },
};

const mockNotificationService = {
  sendNotification: jest.fn(),
};

// ioredis client: default to acquiring the lock so the guarded job body runs.
// Integration injects a raw ioredis client (via NOTIFICATION_REDIS) rather than
// develop's RedisService wrapper, so the mock exposes `set` directly.
const mockRedisClient = {
  set: jest.fn().mockResolvedValue('OK'),
};

describe('NotificationSchedulerService', () => {
  let service: NotificationSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationSchedulerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: NOTIFICATION_REDIS, useValue: mockRedisClient },
      ],
    }).compile();

    service = module.get(NotificationSchedulerService);
    jest.clearAllMocks();
    mockRedisClient.set.mockResolvedValue('OK');
    mockNotificationService.sendNotification.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cluster guard (single-process execution)', () => {
    it('skips the job body when the Redis lock is not acquired', async () => {
      mockRedisClient.set.mockResolvedValueOnce(null);

      await service.sendSubscriptionReminders();

      expect(mockPrismaService.subscription.findMany).not.toHaveBeenCalled();
      expect(mockNotificationService.sendNotification).not.toHaveBeenCalled();
    });

    it('acquires a NX/EX lock keyed per job before running', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValueOnce([]);

      await service.sendSubscriptionReminders();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'cron-lock:subscriptionReminder',
        expect.any(String),
        'EX',
        expect.any(Number),
        'NX',
      );
    });

    it('skips the run when the lock cannot be reached (Redis error)', async () => {
      mockRedisClient.set.mockRejectedValueOnce(new Error('redis down'));

      await service.sendSubscriptionReminders();

      expect(mockPrismaService.subscription.findMany).not.toHaveBeenCalled();
    });
  });

  describe('sendSubscriptionReminders', () => {
    it('paginates beyond the first 500 candidates', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const firstPage = Array.from({ length: 500 }, (_, i) => ({
        id: `sub-${i}`,
        userId: `user-${i}`,
        plan: 'monthly',
        endsAt: future,
      }));
      const secondPage = [
        { id: 'sub-500', userId: 'user-500', plan: 'monthly', endsAt: future },
      ];

      mockPrismaService.subscription.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      await service.sendSubscriptionReminders();

      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledTimes(2);
      // Second call must advance the cursor past the last id of page one.
      expect(mockPrismaService.subscription.findMany.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          cursor: { id: 'sub-499' },
          skip: 1,
        }),
      );
      // Every candidate across both pages is processed.
      expect(mockNotificationService.sendNotification).toHaveBeenCalledTimes(
        501,
      );
    });

    it('resolves the plan display name instead of the raw plan key', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockPrismaService.subscription.findMany.mockResolvedValueOnce([
        { id: 'sub-1', userId: 'user-1', plan: 'monthly', endsAt: future },
      ]);

      await service.sendSubscriptionReminders();

      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(
        'SubscriptionReminder',
        expect.objectContaining({ plan: 'Monthly' }),
        'user-1',
      );
    });

    it('does not log the full user id on failure', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockPrismaService.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-1',
          userId: 'abcdef01-2345-6789-abcd-ef0123456789',
          plan: 'monthly',
          endsAt: future,
        },
      ]);
      mockNotificationService.sendNotification.mockRejectedValueOnce(
        new Error('boom'),
      );
      const errorSpy = jest
        .spyOn(
          (
            service as unknown as {
              logger: { error: (...a: unknown[]) => void };
            }
          ).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await service.sendSubscriptionReminders();

      const logged = String(errorSpy.mock.calls[0][0]);
      expect(logged).toContain('abcdef01');
      expect(logged).not.toContain('abcdef01-2345-6789-abcd-ef0123456789');
    });
  });

  describe('sendWeMissYouReminders', () => {
    it('excludes soft-deleted progress from the inactivity query', async () => {
      mockPrismaService.user.findMany.mockResolvedValueOnce([]);

      await service.sendWeMissYouReminders();

      const where = mockPrismaService.user.findMany.mock.calls[0][0].where;
      expect(where.userStoryProgress).toEqual({
        some: { isDeleted: false },
      });
      expect(where.NOT.userStoryProgress.some).toEqual(
        expect.objectContaining({ isDeleted: false }),
      );
    });
  });

  describe('sendIncompleteStoryReminders', () => {
    it('paginates beyond the first 500 candidates', async () => {
      const firstPage = Array.from({ length: 500 }, (_, i) => ({
        userId: `user-${i}`,
        story: { title: 'A Story' },
      }));
      const secondPage = [{ userId: 'user-500', story: { title: 'A Story' } }];

      mockPrismaService.userStoryProgress.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      await service.sendIncompleteStoryReminders();

      expect(
        mockPrismaService.userStoryProgress.findMany,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockPrismaService.userStoryProgress.findMany.mock.calls[1][0].skip,
      ).toBe(500);
      expect(mockNotificationService.sendNotification).toHaveBeenCalledTimes(
        501,
      );
    });
  });
});
