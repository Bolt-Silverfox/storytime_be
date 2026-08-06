import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { GuestActivityEvent } from '../events/guest-activity.event';

@Injectable()
export class GuestActivityListener {
  private readonly logger = new Logger(GuestActivityListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('guest.activity')
  async handleGuestActivity(event: GuestActivityEvent): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          action: event.action,
          status: event.status,
          details: event.details,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log guest activity (${event.action}): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
