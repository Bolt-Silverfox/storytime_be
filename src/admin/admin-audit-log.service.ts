import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminAuditLog, Prisma } from '@prisma/client';
import {
  ADMIN_AUDIT_LOG_REPOSITORY,
  IAdminAuditLogRepository,
} from './repositories/admin-audit-log.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAdminAuditLogInput {
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ListAdminAuditLogParams {
  page: number;
  limit: number;
  adminId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A date-only ISO string (no time component) should behave as an inclusive
// upper bound for the whole day, not midnight at its start.
function toInclusiveUpperBound(value: string): Date {
  return DATE_ONLY_PATTERN.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}

@Injectable()
export class AdminAuditLogService {
  private readonly logger = new Logger(AdminAuditLogService.name);

  constructor(
    @Inject(ADMIN_AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepo: IAdminAuditLogRepository,
    // Used only to resolve the acting admin's display name from their id —
    // the JWT payload (JwtPayload in auth.guard.ts) carries userId + email
    // but not name, and widening that payload for one audit field wasn't
    // worth it, so this service does its own small, best-effort lookup.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Records an admin audit log entry. Never throws: a logging failure must
   * never block the admin action it is recording, so failures are caught
   * and logged here instead of propagated.
   */
  async record(input: RecordAdminAuditLogInput): Promise<void> {
    try {
      let adminName = 'Unknown';
      const admin = await this.prisma.user.findUnique({
        where: { id: input.adminId },
        select: { name: true },
      });
      if (admin?.name) {
        adminName = admin.name;
      }

      await this.auditLogRepo.create({
        adminId: input.adminId,
        adminName,
        adminEmail: input.adminEmail,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
      });
    } catch (err) {
      this.logger.error(
        `Failed to record admin audit log for action "${input.action}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async list(
    params: ListAdminAuditLogParams,
  ): Promise<PaginatedResult<AdminAuditLog>> {
    const { page, limit, adminId, action, targetType, from, to } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.AdminAuditLogWhereInput = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = action;
    if (targetType) where.targetType = targetType;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        // A date-only `to` (e.g. "2026-02-01") parses to midnight UTC, which
        // would exclude the rest of that day from an "inclusive" upper
        // bound. Push a date-only value to the end of that UTC day; a full
        // timestamp is used as-is.
        ...(to ? { lte: toInclusiveUpperBound(to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.auditLogRepo.findManyPaginated({ where, skip, take: limit }),
      this.auditLogRepo.count(where),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
