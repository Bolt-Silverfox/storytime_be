import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import { NotificationDeviceService } from './notification-device.service';
import { IDeviceTokenRepository } from '../repositories';
import { PushProvider } from '../providers/push.provider';
import { PushQueueService } from '../queue/push-queue.service';

/**
 * Focused unit tests for the env-scoped broadcast topic and the batched
 * broadcast, constructed directly with mocked collaborators (no Nest DI).
 *
 * Each double is typed against the real collaborator with `Pick`, so the stub
 * signatures (and therefore the `mock.calls` assertions below) track the
 * production ones. Only the final widening to the full constructor parameter
 * needs a cast: these are deliberate partial doubles exercising one code path,
 * not full implementations of the interfaces.
 */
function build(nodeEnv: string | undefined) {
  const deviceTokenRepository: jest.Mocked<
    Pick<IDeviceTokenRepository, 'findActiveNotDeletedBatch'>
  > = {
    findActiveNotDeletedBatch: jest.fn(),
  };
  const pushProvider: jest.Mocked<
    Pick<PushProvider, 'subscribeToTopic' | 'unsubscribeFromTopic' | 'isReady'>
  > = {
    subscribeToTopic: jest.fn().mockResolvedValue(undefined),
    unsubscribeFromTopic: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
  };
  const pushQueueService: jest.Mocked<
    Pick<PushQueueService, 'queueTokenBatch'>
  > = {
    queueTokenBatch: jest.fn().mockResolvedValue({ queued: true, jobId: 'x' }),
  };
  const configService = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
  };

  const service = new NotificationDeviceService(
    deviceTokenRepository as unknown as IDeviceTokenRepository,
    pushProvider as unknown as PushProvider,
    pushQueueService as unknown as PushQueueService,
    configService as unknown as ConfigService<EnvConfig, true>,
  );
  return { service, deviceTokenRepository, pushProvider, pushQueueService };
}

describe('NotificationDeviceService - env-scoped broadcast topic', () => {
  it('resolves all_users_<NODE_ENV> for production/staging/development', () => {
    expect(build('production').service.getBroadcastTopic()).toBe(
      'all_users_production',
    );
    expect(build('staging').service.getBroadcastTopic()).toBe(
      'all_users_staging',
    );
    expect(build('development').service.getBroadcastTopic()).toBe(
      'all_users_development',
    );
  });

  it('falls back to all_users_development when NODE_ENV is unset', () => {
    expect(build(undefined).service.getBroadcastTopic()).toBe(
      'all_users_development',
    );
  });

  it('never produces the unscoped global "all_users" topic', () => {
    for (const env of ['production', 'staging', 'development', undefined]) {
      expect(build(env).service.getBroadcastTopic()).not.toBe('all_users');
    }
  });

  describe('subscribeAllExistingDevicesToTopic', () => {
    it('defaults to the env-scoped topic and unsubscribes the batch from legacy all_users', async () => {
      const { service, deviceTokenRepository, pushProvider } = build('staging');
      deviceTokenRepository.findActiveNotDeletedBatch
        .mockResolvedValueOnce([{ id: 'dt-1', token: 'token-1' }])
        .mockResolvedValueOnce([]);

      await service.subscribeAllExistingDevicesToTopic();

      expect(pushProvider.subscribeToTopic).toHaveBeenCalledWith(
        ['token-1'],
        'all_users_staging',
      );
      expect(pushProvider.unsubscribeFromTopic).toHaveBeenCalledWith(
        ['token-1'],
        'all_users',
      );
    });

    it('does NOT unsubscribe when deliberately re-seeding all_users itself', async () => {
      const { service, deviceTokenRepository, pushProvider } = build('staging');
      deviceTokenRepository.findActiveNotDeletedBatch
        .mockResolvedValueOnce([{ id: 'dt-1', token: 'token-1' }])
        .mockResolvedValueOnce([]);

      await service.subscribeAllExistingDevicesToTopic('all_users');

      expect(pushProvider.unsubscribeFromTopic).not.toHaveBeenCalled();
    });
  });

  describe('broadcastBatchedToAllDevices', () => {
    it('de-duplicates tokens, chunks by <= batchSize and staggers delays', async () => {
      const { service, deviceTokenRepository, pushQueueService } =
        build('production');
      const unique = Array.from({ length: 600 }, (_, i) => `dup-${i}`);
      deviceTokenRepository.findActiveNotDeletedBatch.mockImplementation(
        (args: { cursor?: string; take: number }) => {
          // 1200 rows (each token duplicated) delivered in one page.
          if (args.cursor) return Promise.resolve([]);
          const rows = [...unique, ...unique].map((token, i) => ({
            id: `id-${i}`,
            token,
          }));
          return Promise.resolve(rows);
        },
      );

      const summary = await service.broadcastBatchedToAllDevices({
        title: 'Hi',
        body: 'There',
        batchSize: 500,
        intervalSeconds: 60,
      });

      expect(summary.totalDevices).toBe(600);
      expect(summary.batches).toBe(2);
      expect(summary.succeededBatches).toBe(2);
      const delivered = pushQueueService.queueTokenBatch.mock.calls.flatMap(
        (call) => call[0],
      );
      expect(new Set(delivered).size).toBe(600);
      const delays = pushQueueService.queueTokenBatch.mock.calls.map(
        (call) => call[4],
      );
      expect(delays.sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 60_000]);
    });

    it('returns zero and queues nothing when there are no devices', async () => {
      const { service, deviceTokenRepository, pushQueueService } =
        build('production');
      deviceTokenRepository.findActiveNotDeletedBatch.mockResolvedValue([]);

      const summary = await service.broadcastBatchedToAllDevices({
        title: 'Hi',
        body: 'There',
      });

      expect(summary.totalDevices).toBe(0);
      expect(summary.batches).toBe(0);
      expect(pushQueueService.queueTokenBatch).not.toHaveBeenCalled();
    });
  });
});
