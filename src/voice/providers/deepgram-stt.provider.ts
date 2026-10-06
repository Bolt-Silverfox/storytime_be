import { ISpeechToTextProvider } from '../interfaces/speech-provider.interface';
import { DeepgramClient, DeepgramError } from '@deepgram/sdk';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Client-side guard on the prerecorded transcription call (unchanged from v4). */
const TRANSCRIBE_TIMEOUT_MS = 30_000;

@Injectable()
export class DeepgramSTTProvider implements ISpeechToTextProvider {
  private readonly logger = new Logger(DeepgramSTTProvider.name);
  private deepgram: DeepgramClient;
  public readonly name = 'Deepgram';

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPGRAM_API_KEY');
    if (apiKey) {
      // SDK v5 defaults to maxRetries: 2. v4 did not retry, and retries are
      // owned by this codebase's resilience layer, so keep a single attempt.
      this.deepgram = new DeepgramClient({ apiKey, maxRetries: 0 });
    } else {
      this.logger.warn('DEEPGRAM_API_KEY is not set');
    }
  }

  async transcribe(buffer: Buffer, mimetype: string): Promise<string> {
    if (!this.deepgram) {
      throw new ServiceUnavailableException(
        'Deepgram client is not initialized',
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      this.logger.log('Attempting Deepgram STT transcription');

      const transcriptionPromise = this.deepgram.listen.v1.media.transcribeFile(
        // v5 takes the audio as an Uploadable; the mimetype travels as the
        // body's Content-Type instead of a transcription option.
        { data: buffer, contentType: mimetype },
        {
          model: 'nova-2',
          smart_format: true,
        },
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Deepgram transcription timed out after ${
                  TRANSCRIBE_TIMEOUT_MS / 1000
                }s`,
              ),
            ),
          TRANSCRIBE_TIMEOUT_MS,
        );
      });

      // v5 resolves with the parsed body and throws on failure, replacing v4's
      // `{ result, error }` tuple.
      const response = await Promise.race([
        transcriptionPromise,
        timeoutPromise,
      ]);

      if (!('results' in response)) {
        throw new InternalServerErrorException(
          'Deepgram returned an asynchronous response with no transcript',
        );
      }

      const transcript =
        response.results.channels[0]?.alternatives?.[0]?.transcript;

      if (typeof transcript !== 'string') {
        throw new InternalServerErrorException(
          'Deepgram returned no transcript',
        );
      }

      return transcript;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Deepgram STT failed: ${message}`);

      // Preserve v4 semantics: an API-level failure surfaces as a 500 to the
      // caller, anything else propagates unchanged.
      if (error instanceof DeepgramError) {
        throw new InternalServerErrorException(message);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
