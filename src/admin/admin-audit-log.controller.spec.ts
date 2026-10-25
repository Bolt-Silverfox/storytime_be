import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminAuditLogController } from './admin-audit-log.controller';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminAuditLogController', () => {
  let controller: AdminAuditLogController;
  const list = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuditLogController],
      providers: [{ provide: AdminAuditLogService, useValue: { list } }],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AdminAuditLogController);
  });

  it('wires AuthSessionGuard and AdminGuard on the controller (@Admin())', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminAuditLogController),
    ).toEqual([AuthSessionGuard, AdminGuard]);
  });

  it('sanitizes page/limit and forwards filters to the service', async () => {
    list.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });

    const result = await controller.list({
      page: 1,
      limit: 20,
      adminId: 'admin-1',
      action: 'user.suspend',
      targetType: 'User',
      from: '2026-01-01',
      to: '2026-02-01',
    });

    expect(list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      adminId: 'admin-1',
      action: 'user.suspend',
      targetType: 'User',
      from: '2026-01-01',
      to: '2026-02-01',
    });
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  it('caps an oversized limit at the PaginationUtil max (100)', async () => {
    list.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 100, totalPages: 0 },
    });

    await controller.list({ page: 1, limit: 9999 });

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
