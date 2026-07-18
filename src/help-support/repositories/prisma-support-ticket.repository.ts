import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { ISupportTicketRepository } from './support-ticket.repository.interface';
import type { SupportTicket, Prisma } from '@prisma/client';

@Injectable()
export class PrismaSupportTicketRepository implements ISupportTicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.SupportTicketUncheckedCreateInput,
  ): Promise<SupportTicket> {
    return this.prisma.supportTicket.create({ data });
  }

  async findManyByUser(userId: string): Promise<SupportTicket[]> {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUniqueById(id: string): Promise<SupportTicket | null> {
    return this.prisma.supportTicket.findUnique({
      where: { id },
    });
  }
}
