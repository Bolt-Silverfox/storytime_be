import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  GUEST_REPOSITORY,
  type IGuestRepository,
} from '../repositories/guest.repository.interface';
import { GuestActivityEvent } from '../events/guest-activity.event';

@Injectable()
export class GuestActivityListener {
  private readonly logger = new Logger(GuestActivityListener.name);

  constructor(
    @Inject(GUEST_REPOSITORY)
    private readonly guestRepository: IGuestRepository,
  ) {}

  @OnEvent('guest.activity')
  async handleGuestActivity(event: GuestActivityEvent): Promise<void> {
    try {
      await this.guestRepository.createGuestActivityLog({
        action: event.action,
        status: event.status,
        details: event.details,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log guest activity (${event.action}): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
