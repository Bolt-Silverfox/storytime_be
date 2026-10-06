import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepgramClient, DeepgramError } from '@deepgram/sdk';
import { DeepgramSTTProvider } from './deepgram-stt.provider';

const mockTranscribeFile = jest.fn();

jest.mock('@deepgram/sdk', () => {
  class MockDeepgramError extends Error {
    readonly statusCode?: number;

    constructor({
      message,
      statusCode,
    }: {
      message?: string;
      statusCode?: number;
    }) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    DeepgramError: MockDeepgramError,
    DeepgramClient: jest.fn().mockImplementation(() => ({
      listen: {
        v1: {
          media: {
            transcribeFile: (...args: unknown[]) => mockTranscribeFile(...args),
          },
        },
      },
    })),
  };
});

const MockedDeepgramClient = DeepgramClient as unknown as jest.Mock;

/** Minimal v5 `ListenV1Response` shape. */
const v5Response = (transcript?: string) => ({
  metadata: { request_id: 'req-1' },
  results: {
    channels: [
      {
        alternatives: [transcript === undefined ? {} : { transcript }],
      },
    ],
  },
});

const buildProvider = (apiKey?: string): DeepgramSTTProvider => {
  const configService = {
    get: jest.fn().mockReturnValue(apiKey),
  } as unknown as ConfigService;

  return new DeepgramSTTProvider(configService);
};

describe('DeepgramSTTProvider', () => {
  const buffer = Buffer.from('audio');
  const mimetype = 'audio/webm';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructs the v5 client with the API key and retries disabled', () => {
    buildProvider('test-key');

    expect(MockedDeepgramClient).toHaveBeenCalledWith({
      apiKey: 'test-key',
      maxRetries: 0,
    });
  });

  it('does not construct a client when the API key is missing', async () => {
    const provider = buildProvider(undefined);

    expect(MockedDeepgramClient).not.toHaveBeenCalled();
    await expect(provider.transcribe(buffer, mimetype)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('transcribes via listen.v1.media.transcribeFile and returns the transcript', async () => {
    const provider = buildProvider('test-key');
    mockTranscribeFile.mockResolvedValue(v5Response('hello world'));

    await expect(provider.transcribe(buffer, mimetype)).resolves.toBe(
      'hello world',
    );
    expect(mockTranscribeFile).toHaveBeenCalledWith(
      { data: buffer, contentType: mimetype },
      { model: 'nova-2', smart_format: true },
    );
  });

  it('returns an empty transcript as-is', async () => {
    const provider = buildProvider('test-key');
    mockTranscribeFile.mockResolvedValue(v5Response(''));

    await expect(provider.transcribe(buffer, mimetype)).resolves.toBe('');
  });

  it('maps a thrown DeepgramError to a 500, preserving the message', async () => {
    const provider = buildProvider('test-key');
    mockTranscribeFile.mockRejectedValue(
      new DeepgramError({ message: 'Rate limit exceeded', statusCode: 429 }),
    );

    const thrown = await provider
      .transcribe(buffer, mimetype)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(InternalServerErrorException);
    expect((thrown as Error).message).toBe('Rate limit exceeded');
  });

  it('propagates non-Deepgram errors unchanged', async () => {
    const provider = buildProvider('test-key');
    const networkError = new Error('fetch failed');
    mockTranscribeFile.mockRejectedValue(networkError);

    await expect(provider.transcribe(buffer, mimetype)).rejects.toBe(
      networkError,
    );
  });

  it('throws when the response carries no transcript', async () => {
    const provider = buildProvider('test-key');
    mockTranscribeFile.mockResolvedValue(v5Response(undefined));

    await expect(provider.transcribe(buffer, mimetype)).rejects.toThrow(
      'Deepgram returned no transcript',
    );
  });

  it('throws when Deepgram returns an asynchronous (callback) response', async () => {
    const provider = buildProvider('test-key');
    mockTranscribeFile.mockResolvedValue({ request_id: 'req-2' });

    await expect(provider.transcribe(buffer, mimetype)).rejects.toThrow(
      'Deepgram returned an asynchronous response with no transcript',
    );
  });
  it('rejects when transcription outruns the 30s client-side timeout', async () => {
    jest.useFakeTimers();
    try {
      const provider = buildProvider('test-key');
      // Never settles, so only the timer can resolve the race.
      mockTranscribeFile.mockReturnValue(new Promise(() => {}));

      const pending = provider.transcribe(buffer, mimetype);
      const assertion = expect(pending).rejects.toThrow(
        'Deepgram transcription timed out after 30s',
      );

      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the timeout timer once transcription resolves', async () => {
    jest.useFakeTimers();
    try {
      const provider = buildProvider('test-key');
      mockTranscribeFile.mockResolvedValue(v5Response('done'));

      await expect(provider.transcribe(buffer, mimetype)).resolves.toBe('done');

      // A leaked 30s timer per call keeps the event loop alive and shows up as
      // a Jest open handle; the `finally` clearTimeout is what prevents it.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
