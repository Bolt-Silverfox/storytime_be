import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IActivityLogRepository } from './activity-log.repository.interface';
import type { ActivityLog } from '@prisma/client';

@Injectable()
export class PrismaActivityLogRepository implements IActivityLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog> {
    return this.prisma.activityLog.create({
      data,
    });
  }
}
