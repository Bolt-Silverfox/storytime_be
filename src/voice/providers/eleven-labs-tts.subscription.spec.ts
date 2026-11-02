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
});
