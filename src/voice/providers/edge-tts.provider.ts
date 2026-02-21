import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { Injectable, Logger } from '@nestjs/common';
import { EdgeTTS } from '@andresaya/edge-tts';
import { TextChunker } from '../utils/text-chunker';
import { VOICE_CONFIG_SETTINGS } from '../voice.config';

@Injectable()
export class EdgeTTSProvider implements ITextToSpeechProvider {
  private readonly logger = new Logger(EdgeTTSProvider.name);
  public readonly name = 'EdgeTTS';

  constructor(private readonly chunker: TextChunker) {}

  async generateAudio(
    text: string,
    voiceId?: string,
    _model?: string,
  ): Promise<Buffer> {
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
        await tts.synthesize(chunk, voice, {
          rate: config.RATE,
          outputFormat: config.OUTPUT_FORMAT,
        });
        audioBuffers.push(tts.toBuffer());
      } catch (error) {
        this.logger.error(
          `Edge TTS failed on chunk ${i + 1}/${chunks.length}: ${error.message}`,
        );
        throw error;
      }
    }

    return Buffer.concat(audioBuffers);
  }
}
