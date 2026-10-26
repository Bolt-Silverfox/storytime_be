import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminSubscriptionOpsService } from './admin-subscription-ops.service';
import {
  ADMIN_USER_REPOSITORY,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';
import { GoogleVerificationService } from '../payment/google-verification.service';
import { AppleVerificationService } from '../payment/apple-verification.service';

describe('AdminSubscriptionOpsService.activateSubscription', () => {
  let service: AdminSubscriptionOpsService;
  const userRepo = { findActiveById: jest.fn() };
  const subscriptionRepo = {
    findByUserId: jest.fn(),
    upsertForActivation: jest.fn(),
  };
  const activityRepo = { createLog: jest.fn() };

  const dto = {
    plan: 'yearly',
    platform: 'google',
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    reason: 'Press review copy',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    userRepo.findActiveById.mockResolvedValue({ id: 'u1' });
    subscriptionRepo.findByUserId.mockResolvedValue(null);
    subscriptionRepo.upsertForActivation.mockResolvedValue({ id: 's1' });
    activityRepo.createLog.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSubscriptionOpsService,
        { provide: ADMIN_USER_REPOSITORY, useValue: userRepo },
        { provide: ADMIN_SUBSCRIPTION_REPOSITORY, useValue: subscriptionRepo },
        { provide: ADMIN_ACTIVITY_REPOSITORY, useValue: activityRepo },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: GoogleVerificationService, useValue: {} },
        { provide: AppleVerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(AdminSubscriptionOpsService);
  });

  it('marks the row as an admin grant with the granting admin and reason (create and update)', async () => {
    await service.activateSubscription('u1', dto as never, 'admin-9');

    const { create, update } = subscriptionRepo.upsertForActivation.mock
      .calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    for (const data of [create, update]) {
      expect(data).toMatchObject({
        source: 'admin_grant',
        grantedByAdminId: 'admin-9',
        grantReason: 'Press review copy',
      });
    }
  });

  it('still writes the activity-log entry with the reason and admin', async () => {
    await service.activateSubscription('u1', dto as never, 'admin-9');

    expect(activityRepo.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_ACTIVATE_SUBSCRIPTION',
        details: expect.stringContaining('"adminUserId":"admin-9"'),
      }),
    );
  });

  describe('protecting a live store subscription', () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const row = (over: Record<string, unknown>) => ({
      id: 's0',
      userId: 'u1',
      plan: 'monthly',
      status: 'active',
      source: 'store',
      endsAt: future,
      purchaseToken: 'real-google-token',
      platform: 'google',
      ...over,
    });

    it('refuses with 409 when a live store subscription (real token) exists, and writes nothing', async () => {
      subscriptionRepo.findByUserId.mockResolvedValue(row({}));

      await expect(
        service.activateSubscription('u1', dto as never, 'admin-9'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.activateSubscription('u1', dto as never, 'admin-9'),
      ).rejects.toThrow(/active store subscription/i);
      expect(subscriptionRepo.upsertForActivation).not.toHaveBeenCalled();
    });

    it('audit-logs the refused attempt', async () => {
      subscriptionRepo.findByUserId.mockResolvedValue(row({}));
      await service
        .activateSubscription('u1', dto as never, 'admin-9')
        .catch(() => undefined);
      expect(activityRepo.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_ACTIVATE_SUBSCRIPTION',
          status: 'FAILED',
          details: expect.stringContaining('"adminUserId":"admin-9"'),
        }),
      );
    });

    it.each([
      ['expired store sub', row({ endsAt: past })],
      ['cancelled store sub', row({ status: 'cancelled' })],
      [
        'free plan row',
        row({ plan: 'free', purchaseToken: null, platform: null }),
      ],
      [
        'admin grant',
        row({ source: 'admin_grant', purchaseToken: 'admin-activated-1' }),
      ],
      [
        'store row holding an admin-activated token',
        row({ purchaseToken: 'admin-activated-123' }),
      ],
      ['no existing row', null],
    ])('allows activation over %s', async (_name, existing) => {
      subscriptionRepo.findByUserId.mockResolvedValue(existing);

      await expect(
        service.activateSubscription('u1', dto as never, 'admin-9'),
      ).resolves.toBeDefined();
      expect(subscriptionRepo.upsertForActivation).toHaveBeenCalledTimes(1);
      expect(activityRepo.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUCCESS' }),
      );
    });
  });
});
