import { ISpeechToTextProvider } from '../interfaces/speech-provider.interface';
import { ElevenLabsClient } from 'elevenlabs';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ElevenLabsSTTProvider implements ISpeechToTextProvider {
  private readonly logger = new Logger(ElevenLabsSTTProvider.name);
  private client: ElevenLabsClient;
  public readonly name = 'ElevenLabs';

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
    if (apiKey) {
      try {
        this.client = new ElevenLabsClient({ apiKey });
      } catch (err) {
        this.logger.error(
          `Failed to initialize ElevenLabs client: ${err.message}`,
        );
      }
    } else {
      this.logger.warn('ELEVEN_LABS_KEY is not set');
    }
  }

  async transcribe(buffer: Buffer, mimetype: string): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'ElevenLabs client is not initialized',
      );
    }

    try {
      this.logger.log('Attempting ElevenLabs STT transcription');
      const result = await this.client.speechToText.convert({
        file: new Blob([new Uint8Array(buffer)], { type: mimetype }),
        model_id: 'scribe_v2', // Updated to Scribe v2 for better long-form transcription
        tag_audio_events: true,
        diarize: false,
      });

      return result.text;
    } catch (error) {
      this.logger.error(`ElevenLabs STT failed: ${error.message}`);
      throw error;
    }
  }
}
