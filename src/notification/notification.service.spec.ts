import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { EmailQueueService } from './queue/email-queue.service';
import { PushQueueService } from './queue/push-queue.service';
import { DevicePlatform } from './dto/device-token.dto';

/**
 * Build a NotificationService whose ConfigService reports the given NODE_ENV.
 * All other constructor deps are mocked. Returns the service plus the shared
 * mocks that the individual tests assert against.
 */
async function buildService(nodeEnv: string | undefined) {
  const configValues: Record<string, unknown> = {
    NODE_ENV: nodeEnv,
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'secret',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const mockPrisma = {
    deviceToken: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockPushProvider = {
    subscribeToTopic: jest.fn().mockResolvedValue(undefined),
    unsubscribeFromTopic: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationService,
      { provide: ConfigService, useValue: mockConfigService },
      { provide: PrismaService, useValue: mockPrisma },
      { provide: InAppProvider, useValue: {} },
      { provide: EmailProvider, useValue: {} },
      { provide: EmailQueueService, useValue: {} },
      { provide: PushProvider, useValue: mockPushProvider },
      { provide: PushQueueService, useValue: {} },
    ],
  }).compile();

  const service = module.get<NotificationService>(NotificationService);
  return { service, mockPrisma, mockPushProvider };
}

describe('NotificationService - env-scoped broadcast topic', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getBroadcastTopic', () => {
    it('resolves to all_users_production when NODE_ENV=production', async () => {
      const { service } = await buildService('production');
      expect(service.getBroadcastTopic()).toBe('all_users_production');
    });

    it('resolves to all_users_staging when NODE_ENV=staging', async () => {
      const { service } = await buildService('staging');
      expect(service.getBroadcastTopic()).toBe('all_users_staging');
    });

    it('resolves to all_users_development when NODE_ENV=development', async () => {
      const { service } = await buildService('development');
      expect(service.getBroadcastTopic()).toBe('all_users_development');
    });

    it('falls back to all_users_development when NODE_ENV is unset', async () => {
      const { service } = await buildService(undefined);
      expect(service.getBroadcastTopic()).toBe('all_users_development');
    });

    it('never produces the unscoped global "all_users" topic', async () => {
      for (const env of ['production', 'staging', 'development', undefined]) {
        const { service } = await buildService(env);
        expect(service.getBroadcastTopic()).not.toBe('all_users');
      }
    });
  });

  describe('registerDeviceToken', () => {
    it('subscribes a newly registered token to the env-scoped topic', async () => {
      const { service, mockPrisma, mockPushProvider } =
        await buildService('production');

      mockPrisma.deviceToken.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          deviceToken: {
            updateMany: jest.fn(),
            create: jest.fn().mockResolvedValue({
              id: 'dt-1',
              userId: 'user-1',
              token: 'token-abc',
              platform: DevicePlatform.IOS,
              deviceName: null,
              isActive: true,
              isDeleted: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          },
        }),
      );

      await service.registerDeviceToken(
        'user-1',
        'token-abc',
        DevicePlatform.IOS,
      );

      expect(mockPushProvider.subscribeToTopic).toHaveBeenCalledWith(
        ['token-abc'],
        'all_users_production',
      );
      expect(mockPushProvider.subscribeToTopic).not.toHaveBeenCalledWith(
        ['token-abc'],
        'all_users',
      );
    });
  });

  describe('subscribeAllExistingDevicesToTopic', () => {
    it('defaults to the env-scoped topic when no topic is provided', async () => {
      const { service, mockPrisma, mockPushProvider } =
        await buildService('staging');

      mockPrisma.deviceToken.findMany
        .mockResolvedValueOnce([{ id: 'dt-1', token: 'token-1' }])
        .mockResolvedValueOnce([]);

      await service.subscribeAllExistingDevicesToTopic();

      expect(mockPushProvider.subscribeToTopic).toHaveBeenCalledWith(
        ['token-1'],
        'all_users_staging',
      );
    });

    it('also unsubscribes the batch from the legacy all_users topic', async () => {
      const { service, mockPrisma, mockPushProvider } =
        await buildService('staging');

      mockPrisma.deviceToken.findMany
        .mockResolvedValueOnce([{ id: 'dt-1', token: 'token-1' }])
        .mockResolvedValueOnce([]);

      await service.subscribeAllExistingDevicesToTopic();

      // Migration cleanup: same batch is removed from the legacy global topic.
      expect(mockPushProvider.unsubscribeFromTopic).toHaveBeenCalledWith(
        ['token-1'],
        'all_users',
      );
    });

    it('does NOT unsubscribe when deliberately re-seeding all_users itself', async () => {
      const { service, mockPrisma, mockPushProvider } =
        await buildService('staging');

      mockPrisma.deviceToken.findMany
        .mockResolvedValueOnce([{ id: 'dt-1', token: 'token-1' }])
        .mockResolvedValueOnce([]);

      await service.subscribeAllExistingDevicesToTopic('all_users');

      expect(mockPushProvider.unsubscribeFromTopic).not.toHaveBeenCalled();
    });
  });
});
