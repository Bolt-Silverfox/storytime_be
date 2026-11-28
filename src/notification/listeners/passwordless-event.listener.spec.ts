import { Logger } from '@nestjs/common';
import { PasswordlessEventListener } from './passwordless-event.listener';

describe('PasswordlessEventListener', () => {
  const payload = {
    challengeId: 'c1d2e3f4-0000-4000-8000-000000000001',
    email: 'secret.person@example.com',
    code: '482913',
    linkToken: 'A'.repeat(43),
  };

  function build(
    result: { success: boolean; error?: string } | Error,
    baseUrl = 'https://app.test/',
  ) {
    const notificationService = {
      sendNotification:
        result instanceof Error
          ? jest.fn().mockRejectedValue(result)
          : jest.fn().mockResolvedValue(result),
    };
    const config = { get: () => baseUrl };
    return {
      listener: new PasswordlessEventListener(
        notificationService as never,
        config as never,
      ),
      notificationService,
    };
  }

  it('sends the PasswordlessLogin email with the code and a fragment link', async () => {
    const { listener, notificationService } = build({ success: true });
    await listener.handlePasswordlessRequested(payload);
    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      'PasswordlessLogin',
      {
        email: payload.email,
        code: payload.code,
        linkUrl: `https://app.test/auth/magic#t=${payload.linkToken}`,
      },
    );
  });

  it.each([
    'https://app.test/?utm=1',
    'https://app.test/#section',
    'https://app.test/?utm=1#section',
  ])('builds the same link when the base url is %s', async (base) => {
    const { listener, notificationService } = build({ success: true }, base);
    await listener.handlePasswordlessRequested(payload);
    const data = notificationService.sendNotification.mock.calls[0][1];
    expect(data.linkUrl).toBe(
      `https://app.test/auth/magic#t=${payload.linkToken}`,
    );
  });

  it.each([
    ['https://app.test/app', 'https://app.test/app/auth/magic'],
    ['https://app.test/app?utm=1', 'https://app.test/app/auth/magic'],
    ['https://app.test/app#section', 'https://app.test/app/auth/magic'],
    ['https://app.test/app/', 'https://app.test/app/auth/magic'],
    ['https://app.test/app/?utm=1#x', 'https://app.test/app/auth/magic'],
  ])('keeps the path prefix of %s', async (base, expected) => {
    const { listener, notificationService } = build({ success: true }, base);
    await listener.handlePasswordlessRequested(payload);
    const data = notificationService.sendNotification.mock.calls[0][1];
    expect(data.linkUrl).toBe(`${expected}#t=${payload.linkToken}`);
  });

  it('never puts the token in a query string', async () => {
    const { listener, notificationService } = build({ success: true });
    await listener.handlePasswordlessRequested(payload);
    const data = notificationService.sendNotification.mock.calls[0][1];
    expect(data.linkUrl).not.toContain('?');
  });

  const leakingFailures: Array<
    [string, { success: boolean; error?: string } | Error]
  > = [
    [
      'a rejected send',
      new Error(
        `smtp rejected ${payload.email}: code ${payload.code}, link ${payload.linkToken}`,
      ),
    ],
    [
      'an unsuccessful result',
      {
        success: false,
        error: `bounced ${payload.email} code=${payload.code} t=${payload.linkToken}`,
      },
    ],
  ];

  it.each(leakingFailures)(
    'swallows %s and logs only the challenge id',
    async (_label, failure) => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (m) => jest.spyOn(Logger.prototype, m).mockImplementation(),
      );
      try {
        const { listener } = build(failure);

        await expect(
          listener.handlePasswordlessRequested(payload),
        ).resolves.toBeUndefined();

        const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
        expect(logged).toContain(payload.challengeId);
        expect(logged).not.toContain(payload.code);
        expect(logged).not.toContain(payload.linkToken);
        expect(logged).not.toContain('secret.person');
      } finally {
        jest.restoreAllMocks();
      }
    },
  );
});
