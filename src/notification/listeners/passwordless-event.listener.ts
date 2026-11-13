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
    try {
      const base = this.configService.get<string>('WEB_APP_BASE_URL') ?? '';
      const baseUrl = new URL(base);
      if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
      const linkUrl = new URL('auth/magic', baseUrl);
      linkUrl.hash = `t=${payload.linkToken}`;
      const resp = await this.notificationService.sendNotification(
        'PasswordlessLogin',
        {
          email: payload.email,
          code: payload.code,
          linkUrl: linkUrl.toString(),
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
