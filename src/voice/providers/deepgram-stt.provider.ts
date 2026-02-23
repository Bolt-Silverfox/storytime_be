import { ISpeechToTextProvider } from '../interfaces/speech-provider.interface';
import { createClient, DeepgramClient } from '@deepgram/sdk';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DeepgramSTTProvider implements ISpeechToTextProvider {
  private readonly logger = new Logger(DeepgramSTTProvider.name);
  private deepgram: DeepgramClient;
  public readonly name = 'Deepgram';

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPGRAM_API_KEY');
    if (apiKey) {
      this.deepgram = createClient(apiKey);
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

    try {
      this.logger.log('Attempting Deepgram STT transcription');

      const transcriptionPromise =
        this.deepgram.listen.prerecorded.transcribeFile(buffer, {
          model: 'nova-2',
          smart_format: true,
          mimetype: mimetype,
        });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Deepgram transcription timed out after 30s')),
          30000,
        );
      });

      const { result, error } = await Promise.race([
        transcriptionPromise,
        timeoutPromise,
      ]);

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      return result.results.channels[0].alternatives[0].transcript;
    } catch (error) {
      this.logger.error(`Deepgram STT failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
