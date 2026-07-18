import type { SupportTicket, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface ISupportTicketRepository {
  // Create a support ticket
  create(data: Prisma.SupportTicketUncheckedCreateInput): Promise<SupportTicket>;

  // Find all support tickets for a user, ordered by createdAt desc
  findManyByUser(userId: string): Promise<SupportTicket[]>;

  // Find a support ticket by its id
  findUniqueById(id: string): Promise<SupportTicket | null>;
}

export const SUPPORT_TICKET_REPOSITORY = Symbol('SUPPORT_TICKET_REPOSITORY');
