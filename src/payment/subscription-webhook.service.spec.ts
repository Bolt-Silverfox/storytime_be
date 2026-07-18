import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { SubscriptionWebhookService } from './subscription-webhook.service';
import {
  AppleNotificationInfo,
  AppleVerificationService,
} from './apple-verification.service';
import { GoogleVerificationService } from './google-verification.service';

type MockPrisma = {
  webhookEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  subscription: { findFirst: jest.Mock; update: jest.Mock };
};

const SUB = {
  id: 'sub-1',
  userId: 'user-1',
  plan: 'monthly',
  status: 'active',
  startedAt: new Date('2026-01-01'),
  endsAt: new Date('2026-02-01'),
  platform: 'apple',
  productId: 'com.storytime.monthly',
  purchaseToken: 'orig-tx-123',
  isDeleted: false,
  deletedAt: null,
};

const appleInfo = (
  overrides: Partial<AppleNotificationInfo> &
    Pick<AppleNotificationInfo, 'notificationType' | 'notificationUUID'>,
): AppleNotificationInfo => ({
  bundleId: 'com.storytime.app',
  environment: 'Production',
  transactionInfo: {
    originalTransactionId: 'orig-tx-123',
    productId: 'com.storytime.monthly',
    expiresDate: new Date('2026-03-01').getTime(),
  },
  renewalInfo: { originalTransactionId: 'orig-tx-123', autoRenewStatus: 1 },
  raw: {},
  ...overrides,
});

const googleBody = (payload: Record<string, unknown>, messageId = 'msg-1') => ({
  message: {
    data: Buffer.from(JSON.stringify(payload)).toString('base64'),
    messageId,
  },
  subscription: 'projects/x/subscriptions/y',
});

describe('SubscriptionWebhookService', () => {
  let service: SubscriptionWebhookService;
  let prisma: MockPrisma;
  let apple: { parseSignedNotification: jest.Mock };
  let google: { verify: jest.Mock };

  beforeEach(async () => {
    prisma = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'evt-1', status: 'received' }),
        update: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ ...SUB }),
        update: jest.fn().mockResolvedValue({ ...SUB }),
      },
    };
    apple = { parseSignedNotification: jest.fn() };
    google = { verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppleVerificationService, useValue: apple },
        { provide: GoogleVerificationService, useValue: google },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(SubscriptionWebhookService);
  });

  // ---------------------------------------------------------------- Apple ----
  describe('Apple', () => {
    it('activates the subscription on DID_RENEW and records processed', async () => {
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({ notificationType: 'DID_RENEW', notificationUUID: 'a-1' }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res).toEqual({
        duplicate: false,
        status: 'processed',
        action: 'apple:DID_RENEW -> activate',
      });
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'active', endsAt: new Date('2026-03-01') },
      });
      expect(prisma.webhookEvent.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({ status: 'processed' }),
        }),
      );
    });

    it('marks will-not-renew when auto-renew is disabled, keeping endsAt', async () => {
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({
          notificationType: 'DID_CHANGE_RENEWAL_STATUS',
          subtype: 'AUTO_RENEW_DISABLED',
          notificationUUID: 'a-2',
        }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.status).toBe('processed');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'cancelled' },
      });
    });

    it('deactivates on EXPIRED (endsAt set to now)', async () => {
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({ notificationType: 'EXPIRED', notificationUUID: 'a-3' }),
      );

      await service.handleApple({ signedPayload: 'jws' });

      const call = prisma.subscription.update.mock.calls[0][0];
      expect(call.data.status).toBe('cancelled');
      expect(call.data.endsAt).toBeInstanceOf(Date);
    });

    it('revokes access on REFUND', async () => {
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({ notificationType: 'REFUND', notificationUUID: 'a-4' }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });
      expect(res.action).toBe('apple:REFUND -> revoke');
      expect(prisma.subscription.update).toHaveBeenCalled();
    });

    it('skips unknown/no-op notification types without touching the subscription', async () => {
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({
          notificationType: 'DID_CHANGE_RENEWAL_PREF',
          notificationUUID: 'a-5',
        }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });
      expect(res.status).toBe('skipped');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('skips when no matching subscription exists', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({ notificationType: 'DID_RENEW', notificationUUID: 'a-6' }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });
      expect(res.status).toBe('skipped');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('propagates signature-verification failures (never records an event)', async () => {
      apple.parseSignedNotification.mockImplementation(() => {
        throw new BadRequestException('JWS signature verification failed');
      });

      await expect(
        service.handleApple({ signedPayload: 'bad' }),
      ).rejects.toThrow('JWS signature verification failed');
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('is idempotent: an already-processed event is not reprocessed', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-existing',
        status: 'processed',
      });
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({ notificationType: 'DID_RENEW', notificationUUID: 'a-1' }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });
      expect(res).toEqual({
        duplicate: true,
        status: 'processed',
        action: 'duplicate',
      });
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('records failed and rethrows when processing throws (bookkeeping does not mask the error)', async () => {
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({ notificationType: 'DID_RENEW', notificationUUID: 'a-7' }),
      );
      prisma.subscription.update.mockRejectedValue(new Error('db down'));

      await expect(
        service.handleApple({ signedPayload: 'jws' }),
      ).rejects.toThrow('db down');
      expect(prisma.webhookEvent.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });
  });

  // --------------------------------------------------------------- Google ----
  describe('Google', () => {
    beforeEach(() => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        platform: 'google',
        purchaseToken: 'g-token-1',
      });
      google.verify.mockResolvedValue({
        success: true,
        expirationTime: new Date('2026-04-01'),
      });
    });

    it('activates on SUBSCRIPTION_RENEWED and enriches expiry from Play API', async () => {
      const body = googleBody({
        packageName: 'com.storytime.app',
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'g-token-1',
          subscriptionId: 'com.storytime.monthly',
        },
      });

      const res = await service.handleGoogle(body);

      expect(google.verify).toHaveBeenCalled();
      expect(res.action).toBe('google:SUBSCRIPTION_2 -> activate');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'active', endsAt: new Date('2026-04-01') },
      });
    });

    it('marks will-not-renew on SUBSCRIPTION_CANCELED', async () => {
      const body = googleBody(
        {
          subscriptionNotification: {
            notificationType: 3,
            purchaseToken: 'g-token-1',
            subscriptionId: 'com.storytime.monthly',
          },
        },
        'msg-cancel',
      );

      const res = await service.handleGoogle(body);
      expect(res.action).toBe('google:SUBSCRIPTION_3 -> will_not_renew');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'cancelled' },
      });
      expect(google.verify).not.toHaveBeenCalled();
    });

    it('deactivates on SUBSCRIPTION_EXPIRED', async () => {
      const body = googleBody(
        {
          subscriptionNotification: {
            notificationType: 13,
            purchaseToken: 'g-token-1',
            subscriptionId: 'com.storytime.monthly',
          },
        },
        'msg-exp',
      );

      const res = await service.handleGoogle(body);
      expect(res.action).toBe('google:SUBSCRIPTION_13 -> deactivate');
      const call = prisma.subscription.update.mock.calls[0][0];
      expect(call.data.status).toBe('cancelled');
      expect(call.data.endsAt).toBeInstanceOf(Date);
    });

    it('revokes on a voided purchase notification', async () => {
      const body = googleBody(
        {
          voidedPurchaseNotification: {
            purchaseToken: 'g-token-1',
            orderId: 'GPA.1',
          },
        },
        'msg-void',
      );

      const res = await service.handleGoogle(body);
      expect(res.action).toBe('google:voided -> revoke');
      expect(prisma.subscription.update).toHaveBeenCalled();
    });

    it('skips no-op subscription types (e.g. DEFERRED)', async () => {
      const body = googleBody(
        {
          subscriptionNotification: {
            notificationType: 9,
            purchaseToken: 'g-token-1',
          },
        },
        'msg-def',
      );

      const res = await service.handleGoogle(body);
      expect(res.status).toBe('skipped');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('is idempotent for duplicate Pub/Sub messageId', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'e',
        status: 'processed',
      });
      const body = googleBody({
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'g-token-1',
        },
      });

      const res = await service.handleGoogle(body);
      expect(res.duplicate).toBe(true);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('rejects a malformed Pub/Sub envelope (missing messageId) with 400', async () => {
      await expect(
        service.handleGoogle({
          message: { data: 'x', messageId: '' },
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
