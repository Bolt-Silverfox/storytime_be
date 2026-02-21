import { Client } from '@gradio/client';
import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { TextChunker } from '../utils/text-chunker';
import { VOICE_CONFIG_SETTINGS } from '../voice.config';

/** Max audio response size (10 MB) to prevent memory exhaustion */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Hostnames trusted for fetching generated audio from HuggingFace */
const ALLOWED_AUDIO_HOSTS = ['.hf.space', '.huggingface.co', '.gradio.live'];

function isAllowedAudioUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return ALLOWED_AUDIO_HOSTS.some((suffix) => url.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

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
export class StyleTTS2TTSProvider implements ITextToSpeechProvider {
  private readonly logger = new Logger(StyleTTS2TTSProvider.name);
  public readonly name = 'StyleTTS2';
  private readonly spaceId: string;

  constructor(
    private readonly chunker: TextChunker,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.spaceId =
      this.configService.get<string>('STYLE_TTS2_SPACE_ID') ??
      VOICE_CONFIG_SETTINGS.STYLE_TTS2.SPACE_ID;
  }

  async generateAudio(text: string, voiceId?: string): Promise<Buffer> {
    const config = VOICE_CONFIG_SETTINGS.STYLE_TTS2;
    const voice = voiceId ?? 'Richard_Male_EN_US';

    const chunks = this.chunker.chunk(text, config.CHUNK_SIZE);
    const audioBuffers: Buffer[] = [];

    this.logger.log(
      `Generating ${chunks.length} chunk(s) via StyleTTS2 with voice ${voice}`,
    );

    // Connect once, reuse for all chunks; cleanup in finally
    const app = await withTimeout(
      Client.connect(this.spaceId),
      config.TIMEOUT_MS,
      'StyleTTS2 connection',
    );

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
          const result = await withTimeout(
            app.predict('/synthesize', {
              text: chunk,
              voice: voice,
              speed: config.SPEED,
            }),
            config.TIMEOUT_MS,
            'StyleTTS2 prediction',
          );

          const data = result.data as Array<{ url: string }>;
          if (!data?.[0]?.url) {
            throw new Error('No audio URL returned from StyleTTS2');
          }

          const audioUrl = data[0].url;
          if (!isAllowedAudioUrl(audioUrl)) {
            throw new Error(
              `Untrusted audio URL from StyleTTS2: ${new URL(audioUrl).hostname}`,
            );
          }

          const { data: audioData } = await firstValueFrom(
            this.httpService.get<ArrayBuffer>(audioUrl, {
              responseType: 'arraybuffer',
              timeout: config.TIMEOUT_MS,
              maxContentLength: MAX_AUDIO_BYTES,
              maxBodyLength: MAX_AUDIO_BYTES,
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
    } finally {
      // Best-effort cleanup of the Gradio client connection
      try {
        if (typeof (app as { close?: () => void }).close === 'function') {
          (app as { close: () => void }).close();
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    return Buffer.concat(audioBuffers);
  }
}
