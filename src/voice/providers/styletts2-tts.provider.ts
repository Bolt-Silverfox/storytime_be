import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TextChunker } from '../utils/text-chunker';
import { VOICE_CONFIG_SETTINGS } from '../voice.config';

@Injectable()
export class StyleTTS2TTSProvider implements ITextToSpeechProvider {
  private readonly logger = new Logger(StyleTTS2TTSProvider.name);
  public readonly name = 'StyleTTS2';

  constructor(
    private readonly chunker: TextChunker,
    private readonly httpService: HttpService,
  ) {}

  async generateAudio(
    text: string,
    voiceId?: string,
    _model?: string,
  ): Promise<Buffer> {
    const { Client } = await import('@gradio/client');

    const config = VOICE_CONFIG_SETTINGS.STYLE_TTS2;
    const voice = voiceId ?? 'Richard_Male_EN_US';

    const chunks = this.chunker.chunk(text, config.CHUNK_SIZE);
    const audioBuffers: Buffer[] = [];

    this.logger.log(
      `Generating ${chunks.length} chunk(s) via StyleTTS2 with voice ${voice}`,
    );

    // Connect once, reuse for all chunks
    const app = await Promise.race([
      Client.connect(config.SPACE_ID),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('StyleTTS2 connection timeout')),
          config.TIMEOUT_MS,
        ),
      ),
    ]);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const result = await Promise.race([
          app.predict('/synthesize', {
            text: chunk,
            voice: voice,
            speed: config.SPEED,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('StyleTTS2 prediction timeout')),
              config.TIMEOUT_MS,
            ),
          ),
        ]);

        const data = result.data as Array<{ url: string }>;
        if (!data?.[0]?.url) {
          throw new Error('No audio URL returned from StyleTTS2');
        }

        const { data: audioData } = await firstValueFrom(
          this.httpService.get<ArrayBuffer>(data[0].url, {
            responseType: 'arraybuffer',
            timeout: config.TIMEOUT_MS,
          }),
        );
        audioBuffers.push(Buffer.from(audioData));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `StyleTTS2 failed on chunk ${i + 1}/${chunks.length}: ${msg}`,
        );
        throw error;
      }
    }

    return Buffer.concat(audioBuffers);
  }
}
