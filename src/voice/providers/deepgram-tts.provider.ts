import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TextChunker } from '../utils/text-chunker';
import { VOICE_CONFIG_SETTINGS } from '../voice.config';

/** Max audio response size (10 MB) to prevent memory exhaustion */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Race a promise against a timeout, clearing the timer on settle */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

@Injectable()
export class DeepgramTTSProvider implements ITextToSpeechProvider {
  private readonly logger = new Logger(DeepgramTTSProvider.name);
  public readonly name = 'Deepgram';
  private readonly apiKey: string | undefined;

  constructor(
    private readonly chunker: TextChunker,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('DEEPGRAM_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('DEEPGRAM_API_KEY is not set — Deepgram TTS disabled');
    }
  }

  async generateAudio(text: string, voiceId?: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key is not configured');
    }

    const config = VOICE_CONFIG_SETTINGS.DEEPGRAM;
    const model = voiceId ?? config.DEFAULT_MODEL;

    const chunks = this.chunker.chunk(text, config.CHUNK_SIZE);
    const audioBuffers: Buffer[] = [];

    this.logger.log(
      `Generating ${chunks.length} chunk(s) via Deepgram TTS with model ${model}`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const response = await withTimeout(
          firstValueFrom(
            this.httpService.post<ArrayBuffer>(
              `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=${config.ENCODING}`,
              { text: chunk },
              {
                headers: {
                  Authorization: `Token ${this.apiKey}`,
                  'Content-Type': 'application/json',
                },
                responseType: 'arraybuffer',
                maxContentLength: MAX_AUDIO_BYTES,
                maxBodyLength: MAX_AUDIO_BYTES,
              },
            ),
          ),
          config.TIMEOUT_MS,
          'Deepgram TTS',
        );

        audioBuffers.push(Buffer.from(response.data));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Deepgram TTS failed on chunk ${i + 1}/${chunks.length}: ${msg}`,
        );
        throw error;
      }
    }

    return Buffer.concat(audioBuffers);
  }
}
