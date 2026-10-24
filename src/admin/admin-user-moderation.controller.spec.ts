import { Test, TestingModule } from '@nestjs/testing';
import { AdminUserModerationController } from './admin-user-moderation.controller';
import { AdminService } from './admin.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { UpdateUserDto } from './dto/user-management.dto';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminUserModerationController (audit logging)', () => {
  let controller: AdminUserModerationController;
  const suspendUser = jest.fn();
  const bulkUserAction = jest.fn();
  const updateUser = jest.fn();
  const record = jest.fn();

  const req = {
    authUserData: { userId: 'admin-1', email: 'admin@example.com' },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUserModerationController],
      providers: [
        {
          provide: AdminService,
          useValue: {
            suspendUser,
            bulkUserAction,
            updateUser,
          },
        },
        { provide: AdminAuditLogService, useValue: { record } },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AdminUserModerationController);
  });

  it('records a user.suspend audit log entry after suspending a user', async () => {
    suspendUser.mockResolvedValue({ id: 'user-1', isSuspended: true });

    await controller.suspendUser(req, 'user-1');

    expect(suspendUser).toHaveBeenCalledWith('user-1');
    expect(record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: 'user.suspend',
      targetType: 'User',
      targetId: 'user-1',
    });
  });

  it('records a user.bulk_action audit log entry with the action and affected ids', async () => {
    bulkUserAction.mockResolvedValue({ count: 2 });

    await controller.bulkUserAction(req, {
      userIds: ['user-1', 'user-2'],
      action: 'verify',
    });

    expect(record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: 'user.bulk_action',
      targetType: 'User',
      details: {
        action: 'verify',
        userIds: ['user-1', 'user-2'],
        count: 2,
      },
    });
  });

  it('records a user.role_change audit log entry when the generic PUT update changes a role', async () => {
    updateUser.mockResolvedValue({ id: 'user-1', role: 'admin' });

    const dto: UpdateUserDto = { role: 'admin' };
    await controller.updateUser(req, 'user-1', dto);

    expect(record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: 'user.role_change',
      targetType: 'User',
      targetId: 'user-1',
      details: { role: 'admin' },
    });
  });

  it('records a plain user.update audit log entry when the generic PUT update does not touch role', async () => {
    updateUser.mockResolvedValue({ id: 'user-1', name: 'New Name' });

    const dto: UpdateUserDto = { name: 'New Name' };
    await controller.updateUser(req, 'user-1', dto);

    expect(record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: 'user.update',
      targetType: 'User',
      targetId: 'user-1',
      details: { name: 'New Name' },
    });
  });
});
