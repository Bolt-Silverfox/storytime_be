import { ConfigService } from '@nestjs/config';
import {
  ElevenLabsAuthError,
  ElevenLabsTTSProvider,
} from './eleven-labs-tts.provider';
import { StreamConverter } from '../utils/stream-converter';

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

  it('never writes the API key to the logger', async () => {
    const secret = 'sk_super_secret_key_123';
    const provider = build(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('Status code: 401'), {
          statusCode: 401,
          body: { detail: { status: 'invalid_api_key' } },
        }),
      ),
    );
    (provider as unknown as { apiKey: string }).apiKey = secret;
    const logged: string[] = [];
    jest
      .spyOn(provider['logger'], 'error')
      .mockImplementation((m: unknown) => void logged.push(String(m)));
    jest
      .spyOn(provider['logger'], 'warn')
      .mockImplementation((m: unknown) => void logged.push(String(m)));
    await provider.getSubscriptionInfo().catch(() => undefined);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain(secret);
  });
});
