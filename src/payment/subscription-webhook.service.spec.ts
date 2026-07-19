import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
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
    updateMany: jest.Mock;
  };
  subscription: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
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
  lastEventAt: null as Date | null,
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

/** Build a Pub/Sub body from a raw (already base64-encoded) data string. */
const googleBody0 = (data: string, messageId = 'msg-0') => ({
  message: { data, messageId },
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ ...SUB }),
        update: jest.fn().mockResolvedValue({ ...SUB }),
        // CAS writes: default to a matched row (applied). Stale/lost-race tests
        // override this to `{ count: 0 }`.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

    it('rejects a non-object RTDN payload (base64 "null") with 400', async () => {
      const body = googleBody0(
        Buffer.from('null').toString('base64'),
        'msg-null',
      );
      await expect(service.handleGoogle(body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // Malformed input must never reach subscription mutation.
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('rejects a non-object RTDN payload (base64 array) with 400', async () => {
      const body = googleBody0(
        Buffer.from('[1,2,3]').toString('base64'),
        'msg-arr',
      );
      await expect(service.handleGoogle(body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ----------------------------------------------------- idempotency race ----
  describe('idempotency / concurrent duplicate deliveries', () => {
    const renewInfo = () =>
      appleInfo({ notificationType: 'DID_RENEW', notificationUUID: 'race-1' });

    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });

    it('does not reprocess when a concurrent delivery already owns the row (P2002 -> received)', async () => {
      apple.parseSignedNotification.mockReturnValue(renewInfo());
      // Fast-path findUnique: no row yet. Then create loses the race (P2002),
      // and the re-read shows a concurrent delivery is already processing it.
      prisma.webhookEvent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'evt-race', status: 'received' });
      prisma.webhookEvent.create.mockRejectedValueOnce(p2002());

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.duplicate).toBe(true);
      // The losing delivery must NOT run the handler / mutate the subscription.
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('does not reprocess an in-flight (received) event', async () => {
      apple.parseSignedNotification.mockReturnValue(renewInfo());
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-inflight',
        status: 'received',
      });

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.duplicate).toBe(true);
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('processes exactly once: only the delivery that wins the create claim runs the handler', async () => {
      apple.parseSignedNotification.mockReturnValue(renewInfo());

      // Delivery A: no row -> create succeeds -> claims -> processes.
      prisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
      prisma.webhookEvent.create.mockResolvedValueOnce({
        id: 'evt-A',
        status: 'received',
      });
      const resA = await service.handleApple({ signedPayload: 'jws' });

      // Delivery B (concurrent duplicate): create loses (P2002), re-read shows
      // the row is now processed -> idempotent replay, no reprocessing.
      prisma.webhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-A',
        status: 'processed',
      });
      const resB = await service.handleApple({ signedPayload: 'jws' });

      expect(resA.duplicate).toBe(false);
      expect(resA.status).toBe('processed');
      expect(resB.duplicate).toBe(true);
      // Subscription mutated exactly once across both deliveries.
      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    });

    it('retries a previously failed event by atomically re-claiming the row', async () => {
      apple.parseSignedNotification.mockReturnValue(renewInfo());
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-failed',
        status: 'failed',
      });
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-failed', status: 'failed' },
        }),
      );
      expect(res.status).toBe('processed');
      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    });

    it('does not reprocess a failed event if another delivery already re-claimed it', async () => {
      apple.parseSignedNotification.mockReturnValue(renewInfo());
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-failed',
        status: 'failed',
      });
      // The status-guarded claim matched 0 rows -> someone else won.
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 0 });

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.duplicate).toBe(true);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    // ----------------------------------------------- linkedPurchaseToken ----
    describe('linkedPurchaseToken chain', () => {
      it('migrates the token forward when a new token links to an existing subscription', async () => {
        // The event carries a brand-new token ('new-token') that is not stored.
        // Its linkedPurchaseToken points at 'g-token-1', which we do store.
        prisma.subscription.findFirst.mockImplementation(
          ({ where }: { where: { purchaseToken?: string } }) =>
            where.purchaseToken === 'g-token-1'
              ? Promise.resolve({
                  ...SUB,
                  platform: 'google',
                  purchaseToken: 'g-token-1',
                })
              : Promise.resolve(null),
        );
        // First verify() call (chain resolution) returns the link; a later
        // verify() (expiry enrichment) returns the expiry.
        google.verify
          .mockResolvedValueOnce({
            success: true,
            linkedPurchaseToken: 'g-token-1',
          })
          .mockResolvedValue({
            success: true,
            expirationTime: new Date('2026-04-01'),
          });

        const body = googleBody(
          {
            packageName: 'com.storytime.app',
            subscriptionNotification: {
              notificationType: 4, // PURCHASED (re-subscribe/upgrade)
              purchaseToken: 'new-token',
              subscriptionId: 'com.storytime.monthly',
            },
          },
          'msg-link-1',
        );

        const res = await service.handleGoogle(body);

        expect(res.status).toBe('processed');
        expect(res.action).toBe('google:SUBSCRIPTION_4 -> activate');
        // Row's purchaseToken migrated from the old token to the new one via a
        // compare-and-swap guarded on the still-stored linked token.
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-1', purchaseToken: 'g-token-1' },
          data: { purchaseToken: 'new-token' },
        });
      });

      it('follows a multi-hop chain (C -> B -> A, only A known) and caps depth', async () => {
        // Only 'token-A' is stored. Event token 'token-C' links to 'token-B'
        // which links to 'token-A'.
        prisma.subscription.findFirst.mockImplementation(
          ({ where }: { where: { purchaseToken?: string } }) =>
            where.purchaseToken === 'token-A'
              ? Promise.resolve({
                  ...SUB,
                  platform: 'google',
                  purchaseToken: 'token-A',
                })
              : Promise.resolve(null),
        );
        google.verify.mockImplementation(
          ({ purchaseToken }: { purchaseToken: string }) => {
            if (purchaseToken === 'token-C')
              return Promise.resolve({
                success: true,
                linkedPurchaseToken: 'token-B',
              });
            if (purchaseToken === 'token-B')
              return Promise.resolve({
                success: true,
                linkedPurchaseToken: 'token-A',
              });
            // Enrichment call on the resolved (event) token.
            return Promise.resolve({
              success: true,
              expirationTime: new Date('2026-05-01'),
            });
          },
        );

        const body = googleBody(
          {
            packageName: 'com.storytime.app',
            subscriptionNotification: {
              notificationType: 2,
              purchaseToken: 'token-C',
              subscriptionId: 'com.storytime.monthly',
            },
          },
          'msg-link-multi',
        );

        const res = await service.handleGoogle(body);

        expect(res.status).toBe('processed');
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-1', purchaseToken: 'token-A' },
          data: { purchaseToken: 'token-C' },
        });
      });

      it('skips (no crash, no false attribution) when the chain is unknown', async () => {
        prisma.subscription.findFirst.mockResolvedValue(null);
        google.verify.mockResolvedValue({
          success: true,
          linkedPurchaseToken: 'unknown-old-token',
        });

        const body = googleBody(
          {
            packageName: 'com.storytime.app',
            subscriptionNotification: {
              notificationType: 2,
              purchaseToken: 'orphan-token',
              subscriptionId: 'com.storytime.monthly',
            },
          },
          'msg-link-unknown',
        );

        const res = await service.handleGoogle(body);

        expect(res.status).toBe('skipped');
        expect(res.action).toBe(
          'google:SUBSCRIPTION_2 no matching subscription',
        );
        expect(prisma.subscription.update).not.toHaveBeenCalled();
      });

      it('does not infinite-loop on a cyclic chain', async () => {
        prisma.subscription.findFirst.mockResolvedValue(null);
        // token-X links to token-Y which links back to token-X (cycle).
        google.verify.mockImplementation(
          ({ purchaseToken }: { purchaseToken: string }) =>
            Promise.resolve({
              success: true,
              linkedPurchaseToken:
                purchaseToken === 'token-X' ? 'token-Y' : 'token-X',
            }),
        );

        const body = googleBody(
          {
            packageName: 'com.storytime.app',
            subscriptionNotification: {
              notificationType: 2,
              purchaseToken: 'token-X',
              subscriptionId: 'com.storytime.monthly',
            },
          },
          'msg-link-cycle',
        );

        const res = await service.handleGoogle(body);

        expect(res.status).toBe('skipped');
        expect(prisma.subscription.update).not.toHaveBeenCalled();
        // Guard stopped the walk well within the hop cap (no runaway calls).
        expect(google.verify.mock.calls.length).toBeLessThanOrEqual(5);
      });

      it('skips without following the chain when subscriptionId is absent', async () => {
        prisma.subscription.findFirst.mockResolvedValue(null);

        const body = googleBody(
          {
            packageName: 'com.storytime.app',
            subscriptionNotification: {
              notificationType: 2,
              purchaseToken: 'no-product-token',
              // subscriptionId omitted -> cannot query the Play API.
            },
          },
          'msg-link-noproduct',
        );

        const res = await service.handleGoogle(body);

        expect(res.status).toBe('skipped');
        expect(google.verify).not.toHaveBeenCalled();
        expect(prisma.subscription.update).not.toHaveBeenCalled();
      });
    });
  });

  // --------------------------------------- out-of-order delivery watermark ----
  describe('out-of-order delivery protection (event watermark, CAS)', () => {
    const OLD = new Date('2026-05-01T00:00:00Z');
    const NEW = new Date('2026-06-01T00:00:00Z');

    // The watermark guard is a compare-and-swap: the timestamp comparison lives
    // in the `updateMany` WHERE, and the affected-row count decides applied vs
    // skipped. When `eventAt` is known the service uses `updateMany`, never a
    // bare `update`.

    // ------------------------------------------------------------- Apple ----
    it('applies a newer Apple event via a guarded updateMany and advances lastEventAt', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        lastEventAt: OLD,
      });
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({
          notificationType: 'DID_RENEW',
          notificationUUID: 'wm-a-new',
          signedDate: NEW.getTime(),
        }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.status).toBe('processed');
      // State change + watermark advance are a single conditional write.
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'sub-1',
          OR: [{ lastEventAt: null }, { lastEventAt: { lte: NEW } }],
        },
        data: {
          status: 'active',
          endsAt: new Date('2026-03-01'),
          lastEventAt: NEW,
        },
      });
      // No unguarded update when a timestamp is present.
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('skips a stale Apple event when the CAS matches no row (older delivery loses the race)', async () => {
      // Already applied a DID_RENEW at NEW; a delayed EXPIRED at OLD arrives.
      // The conditional write matches zero rows (stored watermark is newer).
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        lastEventAt: NEW,
      });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({
          notificationType: 'EXPIRED',
          notificationUUID: 'wm-a-stale',
          signedDate: OLD.getTime(),
        }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.status).toBe('skipped');
      expect(res.action).toContain('stale/out-of-order');
      // The CAS was attempted (guarded), but nothing was regressed.
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'sub-1' }),
        }),
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('applies a DISTINCT Apple event arriving at the exact same timestamp (equality is not stale)', async () => {
      // Same-millisecond, different notificationUUID -> a distinct event. True
      // duplicates are filtered by the WebhookEvent idempotency layer, so this
      // must be processed, not dropped. The CAS WHERE uses `lte`, so an equal
      // stored watermark still matches.
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        lastEventAt: NEW,
      });
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({
          notificationType: 'DID_RENEW',
          notificationUUID: 'wm-a-same-instant',
          signedDate: NEW.getTime(),
        }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.status).toBe('processed');
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'sub-1',
          OR: [{ lastEventAt: null }, { lastEventAt: { lte: NEW } }],
        },
        data: {
          status: 'active',
          endsAt: new Date('2026-03-01'),
          lastEventAt: NEW,
        },
      });
    });

    it('applies BOTH conflicting same-timestamp events (last-write-wins, not arrival-serialized)', async () => {
      // Two CONFLICTING lifecycle events share the exact same millisecond
      // (distinct notificationUUIDs, so both survive the idempotency layer).
      // The `<=` watermark guard admits both: neither is dropped, and whichever
      // DB write commits last determines the final state. This documents the
      // honest limitation — same-timestamp conflicts are NOT serialized by
      // arrival order (see applyAction's doc comment). Such conflicts do not
      // occur in practice because Apple/Google emit one notification per state
      // transition with distinct timestamps.

      // Event A: DID_RENEW (activate) at NEW. Stored watermark is OLD -> applies.
      prisma.subscription.findFirst.mockResolvedValueOnce({
        ...SUB,
        lastEventAt: OLD,
      });
      prisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
      apple.parseSignedNotification.mockReturnValueOnce(
        appleInfo({
          notificationType: 'DID_RENEW',
          notificationUUID: 'wm-a-tie-renew',
          signedDate: NEW.getTime(),
        }),
      );

      const first = await service.handleApple({ signedPayload: 'jws' });
      expect(first.status).toBe('processed');

      // Event B: EXPIRED (deactivate) at the SAME NEW timestamp. Stored watermark
      // is now NEW; `lte` still matches, so this conflicting event ALSO applies
      // rather than being skipped as "stale" — last-write-wins.
      prisma.subscription.findFirst.mockResolvedValueOnce({
        ...SUB,
        lastEventAt: NEW,
      });
      prisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
      apple.parseSignedNotification.mockReturnValueOnce(
        appleInfo({
          notificationType: 'EXPIRED',
          notificationUUID: 'wm-a-tie-expire',
          signedDate: NEW.getTime(),
        }),
      );

      const second = await service.handleApple({ signedPayload: 'jws' });
      expect(second.status).toBe('processed');
      // The second write still guards on `lte NEW` (equal watermark admitted).
      expect(prisma.subscription.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: 'sub-1',
          OR: [{ lastEventAt: null }, { lastEventAt: { lte: NEW } }],
        },
        data: {
          status: 'cancelled',
          endsAt: expect.any(Date),
          lastEventAt: NEW,
        },
      });
    });

    it('applies an Apple event and sets lastEventAt when no prior watermark exists', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        lastEventAt: null,
      });
      apple.parseSignedNotification.mockReturnValue(
        appleInfo({
          notificationType: 'DID_RENEW',
          notificationUUID: 'wm-a-first',
          signedDate: NEW.getTime(),
        }),
      );

      const res = await service.handleApple({ signedPayload: 'jws' });

      expect(res.status).toBe('processed');
      const call = prisma.subscription.updateMany.mock.calls[0][0];
      expect(call.data.lastEventAt).toEqual(NEW);
      // Guard admits a null stored watermark.
      expect(call.where.OR).toContainEqual({ lastEventAt: null });
    });

    it('simulated concurrent old/new delivery: the newer applies, the older is skipped', async () => {
      // Newer event (NEW): stored watermark is OLD -> CAS matches (count 1).
      prisma.subscription.findFirst.mockResolvedValueOnce({
        ...SUB,
        lastEventAt: OLD,
      });
      prisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
      apple.parseSignedNotification.mockReturnValueOnce(
        appleInfo({
          notificationType: 'DID_RENEW',
          notificationUUID: 'wm-a-conc-new',
          signedDate: NEW.getTime(),
        }),
      );

      const newer = await service.handleApple({ signedPayload: 'jws' });
      expect(newer.status).toBe('processed');

      // Older event (OLD) races in after the watermark advanced to NEW. Both the
      // read and the CAS now see the newer watermark -> count 0 -> skipped.
      prisma.subscription.findFirst.mockResolvedValueOnce({
        ...SUB,
        lastEventAt: NEW,
      });
      prisma.subscription.updateMany.mockResolvedValueOnce({ count: 0 });
      apple.parseSignedNotification.mockReturnValueOnce(
        appleInfo({
          notificationType: 'EXPIRED',
          notificationUUID: 'wm-a-conc-old',
          signedDate: OLD.getTime(),
        }),
      );

      const older = await service.handleApple({ signedPayload: 'jws' });
      expect(older.status).toBe('skipped');
      expect(older.action).toContain('stale/out-of-order');
    });

    // ------------------------------------------------------------ Google ----
    it('applies a newer Google event via a guarded updateMany and advances lastEventAt', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        platform: 'google',
        purchaseToken: 'g-token-1',
        lastEventAt: OLD,
      });
      google.verify.mockResolvedValue({
        success: true,
        expirationTime: new Date('2026-07-01'),
      });
      const body = googleBody(
        {
          eventTimeMillis: String(NEW.getTime()),
          subscriptionNotification: {
            notificationType: 2,
            purchaseToken: 'g-token-1',
            subscriptionId: 'com.storytime.monthly',
          },
        },
        'wm-g-new',
      );

      const res = await service.handleGoogle(body);

      expect(res.status).toBe('processed');
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'sub-1',
          OR: [{ lastEventAt: null }, { lastEventAt: { lte: NEW } }],
        },
        data: {
          status: 'active',
          endsAt: new Date('2026-07-01'),
          lastEventAt: NEW,
        },
      });
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('skips a stale Google EXPIRED that would clobber a newer RENEWED (CAS matches no row)', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...SUB,
        platform: 'google',
        purchaseToken: 'g-token-1',
        lastEventAt: NEW,
      });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
      const body = googleBody(
        {
          eventTimeMillis: String(OLD.getTime()),
          subscriptionNotification: {
            notificationType: 13, // EXPIRED
            purchaseToken: 'g-token-1',
            subscriptionId: 'com.storytime.monthly',
          },
        },
        'wm-g-stale',
      );

      const res = await service.handleGoogle(body);

      expect(res.status).toBe('skipped');
      expect(res.action).toContain('stale/out-of-order');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------- linked-token migration is compare-and-swap ----
  describe('linked-token migration (CAS)', () => {
    it('re-resolves by the event token when the migration CAS loses the race', async () => {
      // Event token 'new-token' is not stored; its linkedPurchaseToken is
      // 'g-token-1', which we DO store. A concurrent delivery migrates the row
      // first, so our guarded updateMany matches 0 rows and we must re-resolve by
      // the (now stored) event token instead of mis-mapping.
      let newTokenLookups = 0;
      prisma.subscription.findFirst.mockImplementation(
        ({ where }: { where: { purchaseToken?: string } }) => {
          if (where.purchaseToken === 'g-token-1') {
            return Promise.resolve({
              ...SUB,
              platform: 'google',
              purchaseToken: 'g-token-1',
            });
          }
          if (where.purchaseToken === 'new-token') {
            // First lookup is the fast-path (token not stored yet) -> null. The
            // second lookup is the post-lost-race re-resolution: a concurrent
            // delivery already migrated the row, so it now holds 'new-token'.
            newTokenLookups += 1;
            if (newTokenLookups === 1) return Promise.resolve(null);
            return Promise.resolve({
              ...SUB,
              platform: 'google',
              purchaseToken: 'new-token',
            });
          }
          return Promise.resolve(null);
        },
      );
      // Lost the migration race.
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
      google.verify
        .mockResolvedValueOnce({
          success: true,
          linkedPurchaseToken: 'g-token-1',
        })
        .mockResolvedValue({
          success: true,
          expirationTime: new Date('2026-04-01'),
        });

      const body = googleBody(
        {
          packageName: 'com.storytime.app',
          subscriptionNotification: {
            notificationType: 4, // PURCHASED
            purchaseToken: 'new-token',
            subscriptionId: 'com.storytime.monthly',
          },
        },
        'msg-link-cas-race',
      );

      const res = await service.handleGoogle(body);

      // The migration CAS was guarded on the still-stored linked token.
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub-1', purchaseToken: 'g-token-1' },
        data: { purchaseToken: 'new-token' },
      });
      // Despite losing the race, the event still resolves and applies.
      expect(res.status).toBe('processed');
      expect(res.action).toBe('google:SUBSCRIPTION_4 -> activate');
    });
  });
});
