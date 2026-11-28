import { Logger } from '@nestjs/common';
import { renderLogCalls } from '@/shared/testing/render-log-calls';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { Request } from 'express';
import { GoogleStrategy } from './google.strategy';

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(),
}));

describe('GoogleStrategy', () => {
  it('logs neither the id_token nor its payload when verification fails', async () => {
    const idToken = 'eyJsentinel.header.signature';
    const email = 'kid.parent@example.com';
    const verifyIdToken = jest
      .fn()
      .mockRejectedValue(
        new Error(`Token used too late: {"email":"${email}"} ${idToken}`),
      );
    (OAuth2Client as unknown as jest.Mock).mockImplementation(() => ({
      verifyIdToken,
    }));
    const logged: unknown[][] = [];
    for (const level of ['log', 'error', 'warn', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logged.push(args);
        });
    }
    const strategy = new GoogleStrategy({
      get: () => 'client-id',
    } as unknown as ConfigService);

    await expect(
      strategy.validate({ body: { idToken } } as Request),
    ).rejects.toThrow('Invalid Google token');

    expect(verifyIdToken).toHaveBeenCalled();
    expect(logged.length).toBeGreaterThan(0);
    expect(renderLogCalls(logged)).not.toContain(idToken);
    expect(renderLogCalls(logged)).not.toContain(email);
  });
});
