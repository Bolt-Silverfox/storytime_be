import { Test, TestingModule } from '@nestjs/testing';
import { AdminAuditLogService } from './admin-audit-log.service';
import { ADMIN_AUDIT_LOG_REPOSITORY } from './repositories/admin-audit-log.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminAuditLogService', () => {
  let service: AdminAuditLogService;
  const create = jest.fn();
  const findManyPaginated = jest.fn();
  const count = jest.fn();
  const findUnique = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuditLogService,
        {
          provide: ADMIN_AUDIT_LOG_REPOSITORY,
          useValue: { create, findManyPaginated, count },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique } },
        },
      ],
    }).compile();
    service = module.get(AdminAuditLogService);
  });

  describe('record', () => {
    it('resolves the admin name from the user table and writes a row', async () => {
      findUnique.mockResolvedValue({ name: 'Jane Admin' });
      create.mockResolvedValue({});

      await service.record({
        adminId: 'admin-1',
        adminEmail: 'jane@example.com',
        action: 'user.suspend',
        targetType: 'User',
        targetId: 'user-1',
        details: { reason: 'abuse' },
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        select: { name: true },
      });
      expect(create).toHaveBeenCalledWith({
        adminId: 'admin-1',
        adminName: 'Jane Admin',
        adminEmail: 'jane@example.com',
        action: 'user.suspend',
        targetType: 'User',
        targetId: 'user-1',
        details: JSON.stringify({ reason: 'abuse' }),
      });
    });

    it('falls back to "Unknown" when the admin user lookup finds no name', async () => {
      findUnique.mockResolvedValue(null);
      create.mockResolvedValue({});

      await service.record({
        adminId: 'admin-1',
        adminEmail: 'jane@example.com',
        action: 'coupon.create',
        targetType: 'Coupon',
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ adminName: 'Unknown' }),
      );
    });

    it('never throws when the underlying write fails (fire-and-forget)', async () => {
      findUnique.mockResolvedValue({ name: 'Jane Admin' });
      create.mockRejectedValue(new Error('db unavailable'));

      await expect(
        service.record({
          adminId: 'admin-1',
          adminEmail: 'jane@example.com',
          action: 'user.suspend',
          targetType: 'User',
          targetId: 'user-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('never throws when resolving the admin name fails', async () => {
      findUnique.mockRejectedValue(new Error('db unavailable'));

      await expect(
        service.record({
          adminId: 'admin-1',
          adminEmail: 'jane@example.com',
          action: 'user.suspend',
          targetType: 'User',
          targetId: 'user-1',
        }),
      ).resolves.toBeUndefined();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns the standard pagination shape', async () => {
      findManyPaginated.mockResolvedValue([{ id: 'log-1' }]);
      count.mockResolvedValue(21);

      const result = await service.list({ page: 2, limit: 10 });

      expect(findManyPaginated).toHaveBeenCalledWith({
        where: {},
        skip: 10,
        take: 10,
      });
      expect(result.meta).toEqual({
        total: 21,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
    });

    it('builds a where clause from the provided filters', async () => {
      findManyPaginated.mockResolvedValue([]);
      count.mockResolvedValue(0);

      await service.list({
        page: 1,
        limit: 20,
        adminId: 'admin-1',
        action: 'user.suspend',
        targetType: 'User',
        from: '2026-01-01',
        to: '2026-02-01',
      });

      expect(findManyPaginated).toHaveBeenCalledWith({
        where: {
          adminId: 'admin-1',
          action: 'user.suspend',
          targetType: 'User',
          createdAt: {
            gte: new Date('2026-01-01'),
            lte: new Date('2026-02-01T23:59:59.999Z'),
          },
        },
        skip: 0,
        take: 20,
      });
    });

    it('treats a date-only `to` as inclusive of the whole day, not its midnight start', async () => {
      findManyPaginated.mockResolvedValue([]);
      count.mockResolvedValue(0);

      await service.list({ page: 1, limit: 20, to: '2026-02-01' });

      const { createdAt } = findManyPaginated.mock.calls[0][0].where;
      expect(createdAt.lte.toISOString()).toBe('2026-02-01T23:59:59.999Z');
    });

    it('uses a full `to` timestamp as-is, without widening it to end-of-day', async () => {
      findManyPaginated.mockResolvedValue([]);
      count.mockResolvedValue(0);

      await service.list({
        page: 1,
        limit: 20,
        to: '2026-02-01T10:00:00.000Z',
      });

      const { createdAt } = findManyPaginated.mock.calls[0][0].where;
      expect(createdAt.lte.toISOString()).toBe('2026-02-01T10:00:00.000Z');
    });
  });
});
