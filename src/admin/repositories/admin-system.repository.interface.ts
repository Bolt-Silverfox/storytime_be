import type { Prisma, User } from '@prisma/client';
import { ActivityLogDto, SubscriptionDto } from '../dto/admin-responses.dto';

export type SupportTicketWithUser = Prisma.SupportTicketGetPayload<{
  include: {
    user: { select: { id: true; name: true; email: true } };
  };
}>;

export interface IAdminSystemRepository {
  // Activity Logs
  findActivityLogs(params: {
    skip?: number;
    take?: number;
    where?: any;
    orderBy?: any;
  }): Promise<ActivityLogDto[]>;
  countActivityLogs(where?: any): Promise<number>;

  // Subscriptions
  findSubscriptions(params: {
    where?: any;
    orderBy?: any;
  }): Promise<SubscriptionDto[]>;

  // Support Tickets
  findSupportTickets(params: {
    skip?: number;
    take?: number;
    where?: any;
    orderBy?: any;
  }): Promise<any[]>;
  countSupportTickets(where?: any): Promise<number>;
  findSupportTicketById(id: string): Promise<any>;
  updateSupportTicket(id: string, status: string): Promise<any>;
  createSupportTicket(data: {
    userId: string;
    subject: string;
    message: string;
  }): Promise<SupportTicketWithUser>;

  // Users (support-ticket ownership check)
  findUserById(userId: string): Promise<User | null>;
}

export const ADMIN_SYSTEM_REPOSITORY = Symbol('ADMIN_SYSTEM_REPOSITORY');
