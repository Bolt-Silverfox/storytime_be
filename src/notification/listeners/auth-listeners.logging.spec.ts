import { Logger } from '@nestjs/common';
import { renderLogCalls } from '@/shared/testing/render-log-calls';
import { PasswordEventListener } from './password-event.listener';
import { AuthEventListener } from './auth-event.listener';
import { NotificationService } from '../notification.service';

const EMAIL = 'parent.sentinel@example.com';
const TOKEN = 'sentinel-token-9f8e7d';

describe('auth notification listeners log no recipient data', () => {
  let logged: unknown[][];
  let sendNotification: jest.Mock;
  let passwordListener: PasswordEventListener;
  let authListener: AuthEventListener;

  beforeEach(() => {
    logged = [];
    for (const level of ['log', 'error', 'warn', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logged.push(args);
        });
    }
    sendNotification = jest
      .fn()
      .mockResolvedValue({ success: false, error: `bounced for ${EMAIL}` });
    const notifications = {
      sendNotification,
    } as unknown as NotificationService;
    passwordListener = new PasswordEventListener(notifications);
    authListener = new AuthEventListener(notifications);
  });

  afterEach(() => jest.restoreAllMocks());

  const expectNothingSensitiveLogged = () => {
    expect(logged.length).toBeGreaterThan(0);
    const text = renderLogCalls(logged);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(TOKEN);
  };

  it('password.reset_requested', async () => {
    await passwordListener.handlePasswordResetRequested({
      userId: 'user-1',
      email: EMAIL,
      resetToken: TOKEN,
    });
    expect(sendNotification).toHaveBeenCalledWith(
      'PasswordReset',
      expect.objectContaining({ email: EMAIL }),
    );
    expectNothingSensitiveLogged();
  });

  it('password.reset_alert', async () => {
    await passwordListener.handlePasswordResetAlert({
      userId: 'user-1',
      email: EMAIL,
      ipAddress: '203.0.113.9',
      userAgent: 'ua',
      timestamp: '2026-11-28T00:00:00Z',
      userName: 'Parent',
    });
    expectNothingSensitiveLogged();
  });

  it('password.reset_alert when sending throws', async () => {
    sendNotification.mockRejectedValue(new Error(`smtp rejected ${EMAIL}`));
    await passwordListener.handlePasswordResetAlert({
      userId: 'user-1',
      email: EMAIL,
      ipAddress: '203.0.113.9',
      userAgent: 'ua',
      timestamp: '2026-11-28T00:00:00Z',
      userName: 'Parent',
    });
    expectNothingSensitiveLogged();
  });

  it('email.verification_requested', async () => {
    await passwordListener.handleEmailVerificationRequested({
      userId: 'user-1',
      email: EMAIL,
      token: TOKEN,
    });
    expectNothingSensitiveLogged();
  });

  it('password.changed', async () => {
    await passwordListener.handlePasswordChanged({
      userId: 'user-1',
      email: EMAIL,
      userName: 'Parent',
    });
    expectNothingSensitiveLogged();
  });

  it('user email verified', () => {
    authListener.handleEmailVerified({
      userId: 'user-1',
      email: EMAIL,
      verifiedAt: new Date(),
    });
    expectNothingSensitiveLogged();
  });
});
