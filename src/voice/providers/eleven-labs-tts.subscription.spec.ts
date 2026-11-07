import { ConfigService } from '@nestjs/config';
import {
  ElevenLabsAuthError,
  ElevenLabsTTSProvider,
} from './eleven-labs-tts.provider';
import { captureException, captureMessage } from '../../sentry-setup';
import { StreamConverter } from '../utils/stream-converter';

jest.mock('../../sentry-setup', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('ElevenLabsTTSProvider.getSubscriptionInfo auth failures', () => {
  const build = (getSubscription: jest.Mock) => {
    const provider = new ElevenLabsTTSProvider(
      { get: jest.fn() } as unknown as ConfigService,
      {} as StreamConverter,
    );
    jest.spyOn(provider['logger'], 'error').mockImplementation(() => undefined);
    (provider as unknown as { client: unknown }).client = {
      user: { getSubscription },
    };
    return provider;
  };

  it('maps 401 missing_permissions to insufficient_key_permission', async () => {
    const provider = build(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('Status code: 401'), {
          statusCode: 401,
          body: { detail: { status: 'missing_permissions' } },
        }),
      ),
    );
    await expect(provider.getSubscriptionInfo()).rejects.toMatchObject({
      reason: 'insufficient_key_permission',
    });
  });

  it('maps 401 invalid_api_key to invalid_key', async () => {
    const provider = build(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('Status code: 401'), {
          statusCode: 401,
          body: { detail: { status: 'invalid_api_key' } },
        }),
      ),
    );
    const err = await provider.getSubscriptionInfo().catch((e) => e);
    expect(err).toBeInstanceOf(ElevenLabsAuthError);
    expect(err.reason).toBe('invalid_key');
  });

  it('maps 403 as well as 401', async () => {
    const provider = build(
      jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Status code: 403'), { status: 403 }),
        ),
    );
    await expect(provider.getSubscriptionInfo()).rejects.toBeInstanceOf(
      ElevenLabsAuthError,
    );
  });

  it('detects a missing user_read scope from the message when no body is present', async () => {
    const provider = build(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('missing the permission user_read'), {
          statusCode: 401,
        }),
      ),
    );
    await expect(provider.getSubscriptionInfo()).rejects.toMatchObject({
      reason: 'insufficient_key_permission',
    });
  });

  it('never leaks the API key to any logger method or Sentry call', async () => {
    const secret = 'sk_SENTINEL_secret_key_123';
    const config = {
      get: jest.fn((k: string) =>
        k === 'ELEVEN_LABS_KEY' ? secret : undefined,
      ),
    } as unknown as ConfigService;
    const provider = new ElevenLabsTTSProvider(config, {} as StreamConverter);
    const sdkError = Object.assign(new Error('Status code: 401'), {
      statusCode: 401,
      body: { detail: { status: 'invalid_api_key', message: secret } },
      config: { headers: { 'xi-api-key': secret } },
      cause: new Error(`bad key ${secret}`),
    });
    (provider as unknown as { client: unknown }).client = {
      user: { getSubscription: jest.fn().mockRejectedValue(sdkError) },
    };
    const calls: unknown[][] = [];
    for (const m of [
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      jest
        .spyOn(provider['logger'], m)
        .mockImplementation((...args: unknown[]) => void calls.push(args));
    }
    const err = await provider.getSubscriptionInfo().catch((e) => e);
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).not.toContain(secret);
    expect(JSON.stringify({ m: err.message, r: err.reason })).not.toContain(
      secret,
    );
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
