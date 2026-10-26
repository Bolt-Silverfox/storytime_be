import { Test, TestingModule } from '@nestjs/testing';
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
});
