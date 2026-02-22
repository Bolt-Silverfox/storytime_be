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

/** Standard WAV header size (RIFF + fmt + data sub-chunk header) */
const WAV_HEADER_SIZE = 44;

/**
 * Merge multiple WAV buffers into a single valid WAV file.
 * Each buffer from Gradio is a complete WAV with its own RIFF header.
 * Naive concatenation produces corrupt audio — we strip headers from
 * chunks 2+ and patch the first header's size fields.
 */
function mergeWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];

  // Verify the first buffer looks like a WAV (RIFF header)
  const first = buffers[0];
  if (
    first.length < WAV_HEADER_SIZE ||
    first.toString('ascii', 0, 4) !== 'RIFF'
  ) {
    // Not WAV — fall back to simple concatenation (shouldn't happen)
    return Buffer.concat(buffers);
  }

  // Extract PCM data from each chunk (skip 44-byte header on chunks 2+)
  const pcmChunks: Buffer[] = [first.subarray(WAV_HEADER_SIZE)];
  for (let i = 1; i < buffers.length; i++) {
    const buf = buffers[i];
    if (
      buf.length > WAV_HEADER_SIZE &&
      buf.toString('ascii', 0, 4) === 'RIFF'
    ) {
      pcmChunks.push(buf.subarray(WAV_HEADER_SIZE));
    } else {
      // Not a WAV — append as-is (raw PCM)
      pcmChunks.push(buf);
    }
  }

  const totalPcmLength = pcmChunks.reduce((sum, b) => sum + b.length, 0);

  // Clone the first header and patch size fields
  const header = Buffer.from(first.subarray(0, WAV_HEADER_SIZE));
  // Bytes 4-7: RIFF chunk size = total file size - 8
  header.writeUInt32LE(totalPcmLength + WAV_HEADER_SIZE - 8, 4);
  // Bytes 40-43: data sub-chunk size = total PCM length
  header.writeUInt32LE(totalPcmLength, 40);

  return Buffer.concat([header, ...pcmChunks]);
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
          // Gradio positional args: [text, voice, speed]
          const result = await withTimeout(
            app.predict(config.ENDPOINT, [chunk, voice, config.SPEED]),
            config.TIMEOUT_MS,
            'StyleTTS2 prediction',
          );

          const data = result.data as Array<{ url: string }>;
          if (!data?.[0]?.url) {
            throw new Error('No audio URL returned from StyleTTS2');
          }

          const audioUrl = data[0].url;
          if (!isAllowedAudioUrl(audioUrl)) {
            throw new Error(`Untrusted audio URL from StyleTTS2: ${audioUrl}`);
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

    return mergeWavBuffers(audioBuffers);
  }
}
