import { Test, TestingModule } from '@nestjs/testing';
import { PrismaAdminAuditLogRepository } from './prisma-admin-audit-log.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('PrismaAdminAuditLogRepository', () => {
  let repo: PrismaAdminAuditLogRepository;
  const findMany = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaAdminAuditLogRepository,
        {
          provide: PrismaService,
          useValue: { adminAuditLog: { findMany } },
        },
      ],
    }).compile();
    repo = module.get(PrismaAdminAuditLogRepository);
  });

  describe('findManyPaginated', () => {
    it('orders by createdAt desc with id desc as a unique tie-breaker', async () => {
      findMany.mockResolvedValue([]);

      await repo.findManyPaginated({ where: {}, skip: 0, take: 20 });

      expect(findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });
  });
});
