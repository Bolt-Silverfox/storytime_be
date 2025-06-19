import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);
  private readonly baseUrl = 'https://api.elevenlabs.io/v1';
  private readonly defaultVoice = 'Rachel'; // You can make this configurable

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async generateAudioBuffer(
    text: string,
    voice: string = this.defaultVoice,
  ): Promise<{ buffer: Buffer; filename: string }> {
    try {
      const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/text-to-speech/${voice}`,
          { text },
          {
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer',
          },
        ),
      );
      const buffer = Buffer.from(response.data);
      const filename = `story-${Date.now()}`;
      return { buffer, filename };
    } catch (error) {
      this.logger.error('Failed to generate audio with Eleven Labs', error);
      throw error;
    }
  }

  async fetchAvailableVoices(): Promise<any[]> {
    const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
    const response = await firstValueFrom(
      this.httpService.get('https://api.elevenlabs.io/v2/voices', {
        headers: { 'xi-api-key': apiKey },
      }),
    );
    return response.data.voices; // Array of voices
  }
}
