import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class SupportService {
  async createTicket(userId: string, subject: string, message: string) {
    return prisma.supportTicket.create({
      data: {
        userId,
        subject,
        message,
      },
    });
  }

  async listMyTickets(userId: string) {
    return prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTicket(userId: string, id: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Ticket not found');
    return ticket;
  }
}
