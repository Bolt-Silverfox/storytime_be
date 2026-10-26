import { Test } from '@nestjs/testing';
import { AdminFxRateController } from './admin-fx-rate.controller';
import { AdminFxRateService } from './admin-fx-rate.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminFxRateController', () => {
  const svc = { list: jest.fn(), create: jest.fn(), remove: jest.fn() };
  const record = jest.fn();
  const req = {
    authUserData: { userId: 'admin-1', email: 'admin@example.com' },
  } as unknown as AuthenticatedRequest;
  let controller: AdminFxRateController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [AdminFxRateController],
      providers: [
        { provide: AdminFxRateService, useValue: svc },
        { provide: AdminAuditLogService, useValue: { record } },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(AdminFxRateController);
  });

  it('is admin-only (guarded like other admin controllers)', () => {
    const guards =
      Reflect.getMetadata('__guards__', AdminFxRateController) ?? [];
    expect(guards.length).toBeGreaterThan(0);
  });

  it('GET lists, optionally filtered by currency', async () => {
    svc.list.mockResolvedValue([{ id: 'r1' }]);
    const res = await controller.list('NGN');
    expect(svc.list).toHaveBeenCalledWith('NGN');
    expect(res.data).toEqual([{ id: 'r1' }]);
  });

  it('POST creates, passes the admin id and audit-logs fx_rate.create', async () => {
    const created = {
      id: 'r1',
      currency: 'NGN',
      rateToUsd: 0.00065,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    };
    svc.create.mockResolvedValue(created);
    const res = await controller.create(req, {
      currency: 'NGN',
      rateToUsd: 0.00065,
    });
    expect(svc.create).toHaveBeenCalledWith(
      { currency: 'NGN', rateToUsd: 0.00065 },
      'admin-1',
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        adminEmail: 'admin@example.com',
        action: 'fx_rate.create',
        targetType: 'FxRate',
        targetId: 'r1',
        details: expect.objectContaining({
          currency: 'NGN',
          rateToUsd: 0.00065,
        }),
      }),
    );
    expect(res.data).toBe(created);
  });

  it('DELETE removes and audit-logs fx_rate.delete with the removed values', async () => {
    svc.remove.mockResolvedValue({
      id: 'r1',
      currency: 'NGN',
      rateToUsd: 0.00065,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await controller.remove(req, 'r1');
    expect(svc.remove).toHaveBeenCalledWith('r1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fx_rate.delete',
        targetType: 'FxRate',
        targetId: 'r1',
        details: expect.objectContaining({ currency: 'NGN' }),
      }),
    );
  });
});
