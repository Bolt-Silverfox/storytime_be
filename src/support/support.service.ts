import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/render';
import { AdminSupportTicketTemplate } from '../notification/templates/admin-support-ticket';

const prisma = new PrismaClient();

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) { }

  async createTicket(userId: string, subject: string, message: string) {
    const ticket = await prisma.supportTicket.create({
      data: {
        userId,
        subject,
        message,
      },
    });

    // Send email notification to support/admin using template
    const supportEmail = this.configService.get<string>('SUPPORT_EMAIL') || 'admin@storytime.com';
    const emailSubject = `[Support Ticket] ${subject}`;

    const emailHtml = await render(
      AdminSupportTicketTemplate({
        userId,
        ticketId: ticket.id,
        subject,
        message,
      })
    );

    this.notificationService.sendEmail(supportEmail, emailSubject, emailHtml).catch(err => {
      this.logger.error(`Failed to send support email: ${err.message}`);
    });

    return ticket;
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
