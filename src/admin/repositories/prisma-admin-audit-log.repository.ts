import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminAuditLog, Prisma } from '@prisma/client';
import type {
  IAdminAuditLogRepository,
  CreateAdminAuditLogInput,
} from './admin-audit-log.repository.interface';

@Injectable()
export class PrismaAdminAuditLogRepository implements IAdminAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateAdminAuditLogInput): Promise<AdminAuditLog> {
    return this.prisma.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        details: input.details ?? null,
      },
    });
  }

  findManyPaginated(params: {
    where: Prisma.AdminAuditLogWhereInput;
    skip: number;
    take: number;
  }): Promise<AdminAuditLog[]> {
    return this.prisma.adminAuditLog.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      // `id` is a unique secondary sort key: rows sharing the same
      // `createdAt` near a page boundary would otherwise have no stable
      // order, letting skip/take duplicate or skip a row across pages.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  count(where: Prisma.AdminAuditLogWhereInput): Promise<number> {
    return this.prisma.adminAuditLog.count({ where });
  }
}
