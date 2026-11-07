import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';

@Injectable()
export class PasswordlessEventListener {
  private readonly logger = new Logger(PasswordlessEventListener.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  @OnEvent('passwordless.requested')
  async handlePasswordlessRequested(payload: {
    challengeId: string;
    email: string;
    code: string;
    linkToken: string;
  }): Promise<void> {
    const base = (
      this.configService.get<string>('WEB_APP_BASE_URL') ?? ''
    ).replace(/\/+$/, '');
    try {
      const resp = await this.notificationService.sendNotification(
        'PasswordlessLogin',
        {
          email: payload.email,
          code: payload.code,
          linkUrl: `${base}/auth/magic#t=${payload.linkToken}`,
        },
      );
      if (!resp.success) {
        this.logger.error(
          `Passwordless email failed for challenge ${payload.challengeId}`,
        );
      }
    } catch {
      this.logger.error(
        `Passwordless email failed for challenge ${payload.challengeId}`,
      );
    }
  }
}
