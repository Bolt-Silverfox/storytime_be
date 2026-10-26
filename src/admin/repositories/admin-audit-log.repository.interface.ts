import type { AdminAuditLog, Prisma } from '@prisma/client';

export interface CreateAdminAuditLogInput {
  adminId: string;
  adminName: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: string | null;
}

export interface IAdminAuditLogRepository {
  create(input: CreateAdminAuditLogInput): Promise<AdminAuditLog>;
  findManyPaginated(params: {
    where: Prisma.AdminAuditLogWhereInput;
    skip: number;
    take: number;
  }): Promise<AdminAuditLog[]>;
  count(where: Prisma.AdminAuditLogWhereInput): Promise<number>;
}

export const ADMIN_AUDIT_LOG_REPOSITORY = Symbol('ADMIN_AUDIT_LOG_REPOSITORY');
