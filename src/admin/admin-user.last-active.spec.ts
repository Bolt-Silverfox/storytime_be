import { AdminUserService } from './admin-user.service';
import { AdminExportService } from './admin-export.service';

describe('AdminUserService lastLoginAt / lastActiveAt', () => {
  const login = new Date('2026-10-01T10:00:00Z');
  const active = new Date('2026-10-20T08:00:00Z');

  const baseDetail = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'a@b.c',
    passwordHash: 'x',
    pinHash: null,
    lastLoginAt: login,
    subscription: null,
    _count: {
      auth: 1,
      parentFavorites: 0,
      voices: 0,
      supportTickets: 0,
      paymentTransactions: 0,
    },
    ...over,
  });
  const baseListRow = (id: string, over: Record<string, unknown> = {}) => ({
    ...baseDetail({ id }),
    createdAt: new Date('2026-01-01'),
    kids: [],
    usage: null,
    paymentTransactions: [],
    _count: { kids: 0, auth: 1, parentFavorites: 0, paymentTransactions: 0 },
    ...over,
  });

  let userRepo: {
    findByIdWithDetails: jest.Mock;
    findManyWithDetails: jest.Mock;
    count: jest.Mock;
    findLastActivityByUserIds: jest.Mock;
  };
  let service: AdminUserService;

  beforeEach(() => {
    userRepo = {
      findByIdWithDetails: jest.fn(),
      findManyWithDetails: jest.fn(),
      count: jest.fn().mockResolvedValue(2),
      findLastActivityByUserIds: jest.fn(),
    };
    service = new AdminUserService(
      userRepo as never,
      { findSuccessfulByUser: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  describe('getUserById', () => {
    it('exposes lastLoginAt and lastActiveAt = newest session activity', async () => {
      userRepo.findByIdWithDetails.mockResolvedValue(baseDetail());
      userRepo.findLastActivityByUserIds.mockResolvedValue(
        new Map([['u1', active]]),
      );
      const r = await service.getUserById('u1');
      expect(r.lastLoginAt).toEqual(login);
      expect(r.lastActiveAt).toEqual(active);
      expect(userRepo.findLastActivityByUserIds).toHaveBeenCalledWith(['u1']);
    });

    it('uses the greatest of recorded activity and lastLoginAt (login newer than stale activity)', async () => {
      const staleActivity = new Date('2026-09-01T00:00:00Z');
      userRepo.findByIdWithDetails.mockResolvedValue(baseDetail());
      userRepo.findLastActivityByUserIds.mockResolvedValue(
        new Map([['u1', staleActivity]]),
      );
      expect((await service.getUserById('u1')).lastActiveAt).toEqual(login);
    });

    it('falls back to lastLoginAt when there is no session activity', async () => {
      userRepo.findByIdWithDetails.mockResolvedValue(baseDetail());
      userRepo.findLastActivityByUserIds.mockResolvedValue(new Map());
      expect((await service.getUserById('u1')).lastActiveAt).toEqual(login);
    });

    it('is null/null for a user who never logged in and has no sessions', async () => {
      userRepo.findByIdWithDetails.mockResolvedValue(
        baseDetail({ lastLoginAt: null }),
      );
      userRepo.findLastActivityByUserIds.mockResolvedValue(new Map());
      const r = await service.getUserById('u1');
      expect(r.lastLoginAt).toBeNull();
      expect(r.lastActiveAt).toBeNull();
    });

    it('keeps existing response fields (additive only)', async () => {
      userRepo.findByIdWithDetails.mockResolvedValue(baseDetail());
      userRepo.findLastActivityByUserIds.mockResolvedValue(new Map());
      const r = await service.getUserById('u1');
      expect(r).toEqual(
        expect.objectContaining({
          id: 'u1',
          isPaidUser: false,
          stats: expect.any(Object),
        }),
      );
      expect(r.passwordHash).toBeUndefined();
    });
  });

  describe('getAllUsers', () => {
    it('adds both fields to every row using ONE grouped lookup (no N+1)', async () => {
      userRepo.findManyWithDetails.mockResolvedValue([
        baseListRow('u1'),
        baseListRow('u2', { lastLoginAt: null }),
      ]);
      userRepo.findLastActivityByUserIds.mockResolvedValue(
        new Map([['u1', active]]),
      );
      const r = await service.getAllUsers({ page: 1, limit: 10 });
      expect(userRepo.findLastActivityByUserIds).toHaveBeenCalledTimes(1);
      expect(userRepo.findLastActivityByUserIds).toHaveBeenCalledWith([
        'u1',
        'u2',
      ]);
      expect(r.data[0]).toEqual(
        expect.objectContaining({ lastLoginAt: login, lastActiveAt: active }),
      );
      expect(r.data[1]).toEqual(
        expect.objectContaining({ lastLoginAt: null, lastActiveAt: null }),
      );
    });

    it('list rows also take the greatest of activity and lastLoginAt', async () => {
      userRepo.findManyWithDetails.mockResolvedValue([baseListRow('u1')]);
      userRepo.findLastActivityByUserIds.mockResolvedValue(
        new Map([['u1', new Date('2026-09-01T00:00:00Z')]]),
      );
      const r = await service.getAllUsers({ page: 1, limit: 10 });
      expect(r.data[0].lastActiveAt).toEqual(login);
    });

    it('skips the lookup for an empty page', async () => {
      userRepo.findManyWithDetails.mockResolvedValue([]);
      await service.getAllUsers({ page: 1, limit: 10 });
      expect(userRepo.findLastActivityByUserIds).not.toHaveBeenCalled();
    });

    it('supports sortBy=lastLoginAt with nulls last', async () => {
      userRepo.findManyWithDetails.mockResolvedValue([]);
      await service.getAllUsers({
        sortBy: 'lastLoginAt',
        sortOrder: 'desc',
      } as never);
      expect(userRepo.findManyWithDetails.mock.calls[0][0].orderBy).toEqual({
        lastLoginAt: { sort: 'desc', nulls: 'last' },
      });
    });
  });

  describe('users CSV export', () => {
    it('includes Last Login and Last Active columns', async () => {
      const adminUserService = {
        getAllUsers: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'u1',
              email: 'a@b.c',
              name: 'A',
              role: 'parent',
              isEmailVerified: true,
              isPaidUser: false,
              registrationDate: new Date('2026-01-01T00:00:00Z'),
              isDeleted: false,
              isSuspended: false,
              lastLoginAt: login,
              lastActiveAt: active,
            },
          ],
        }),
      };
      const exporter = new AdminExportService(
        adminUserService as never,
        {} as never,
      );
      const [header, row] = (await exporter.exportUsersAsCsv({})).split('\n');
      expect(header.split(',').slice(0, 10).join(',')).toBe(
        'ID,Email,Name,Role,Email Verified,Is Paid,Subscription Plan,Registration Date,Is Deleted,Is Suspended',
      );
      expect(header.split(',').slice(10)).toEqual([
        'Last Login',
        'Last Active',
      ]);
      expect(
        row.endsWith(`${login.toISOString()},${active.toISOString()}`),
      ).toBe(true);
    });
  });
});
