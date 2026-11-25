import { ConfigService } from '@nestjs/config';
import { ElevenLabsError } from 'elevenlabs';
import { ElevenLabsTTSProvider } from './eleven-labs-tts.provider';
import { StreamConverter } from '../utils/stream-converter';

const mockVoicesDelete = jest.fn();

jest.mock('elevenlabs', () => ({
  ...jest.requireActual<typeof import('elevenlabs')>('elevenlabs'),
  ElevenLabsClient: jest.fn().mockImplementation(() => ({
    voices: { delete: mockVoicesDelete },
  })),
}));

const providerWithKey = (apiKey: string | undefined) =>
  new ElevenLabsTTSProvider(
    {
      get: (key: string) => (key === 'ELEVEN_LABS_KEY' ? apiKey : undefined),
    } as unknown as ConfigService,
    {} as StreamConverter,
  );

describe('ElevenLabsTTSProvider.deleteVoice', () => {
  beforeEach(() => {
    mockVoicesDelete.mockReset();
  });

  it('deletes the voice at ElevenLabs', async () => {
    mockVoicesDelete.mockResolvedValue({ status: 'ok' });

    await providerWithKey('key').deleteVoice('clone-1');

    expect(mockVoicesDelete).toHaveBeenCalledTimes(1);
    expect(mockVoicesDelete).toHaveBeenCalledWith('clone-1');
  });

  it('treats a 404 from ElevenLabs as already deleted', async () => {
    mockVoicesDelete.mockRejectedValue(
      new ElevenLabsError({ statusCode: 404, body: { detail: 'Not Found' } }),
    );

    await expect(
      providerWithKey('key').deleteVoice('clone-1'),
    ).resolves.toBeUndefined();
  });

  it.each(['voice_does_not_exist', 'voice_not_found'])(
    'treats a 400 with status %s as already deleted',
    async (status) => {
      mockVoicesDelete.mockRejectedValue(
        new ElevenLabsError({
          statusCode: 400,
          body: { detail: { status, message: 'gone' } },
        }),
      );

      await expect(
        providerWithKey('key').deleteVoice('clone-1'),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    new ElevenLabsError({ statusCode: 500, body: { detail: 'boom' } }),
    new ElevenLabsError({ statusCode: 401, body: { detail: 'bad key' } }),
    new ElevenLabsError({
      statusCode: 400,
      body: { detail: { status: 'invalid_uid', message: 'bad id' } },
    }),
    Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }),
  ])('rethrows a failed delete (%s)', async (failure) => {
    mockVoicesDelete.mockRejectedValue(failure);

    await expect(providerWithKey('key').deleteVoice('clone-1')).rejects.toBe(
      failure,
    );
  });

  it('fails when the client has no API key', async () => {
    await expect(
      providerWithKey(undefined).deleteVoice('clone-1'),
    ).rejects.toThrow('ElevenLabs client is not initialized');
    expect(mockVoicesDelete).not.toHaveBeenCalled();
  });
});
