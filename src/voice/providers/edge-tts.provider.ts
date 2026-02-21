import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { Injectable, Logger } from '@nestjs/common';
import { EdgeTTS } from '@andresaya/edge-tts';
import { TextChunker } from '../utils/text-chunker';
import { VOICE_CONFIG_SETTINGS } from '../voice.config';

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
export class EdgeTTSProvider implements ITextToSpeechProvider {
  private readonly logger = new Logger(EdgeTTSProvider.name);
  public readonly name = 'EdgeTTS';

  constructor(private readonly chunker: TextChunker) {}

  async generateAudio(text: string, voiceId?: string): Promise<Buffer> {
    const config = VOICE_CONFIG_SETTINGS.EDGE_TTS;
    const voice = voiceId ?? 'en-US-AndrewMultilingualNeural';

    const chunks = this.chunker.chunk(text, config.CHUNK_SIZE);
    const audioBuffers: Buffer[] = [];

    this.logger.log(
      `Generating ${chunks.length} chunk(s) via Edge TTS with voice ${voice}`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        // Create a fresh instance per chunk (internal buffer accumulates)
        const tts = new EdgeTTS();
        await withTimeout(
          tts.synthesize(chunk, voice, {
            rate: config.RATE,
            outputFormat: config.OUTPUT_FORMAT,
          }),
          config.TIMEOUT_MS,
          'Edge TTS synthesis',
        );
        audioBuffers.push(tts.toBuffer());
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Edge TTS failed on chunk ${i + 1}/${chunks.length}: ${msg}`,
        );
        throw error;
      }
    }

    return Buffer.concat(audioBuffers);
  }
}
