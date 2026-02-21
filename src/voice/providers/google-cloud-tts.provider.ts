import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { Injectable, Logger } from '@nestjs/common';
import { SSMLFormatter } from '../utils/ssml-formatter';
import { TextChunker } from '../utils/text-chunker';
import { VOICE_CONFIG_SETTINGS } from '../voice.config';
import * as textToSpeech from '@google-cloud/text-to-speech';

@Injectable()
export class GoogleCloudTTSProvider implements ITextToSpeechProvider {
  private readonly logger = new Logger(GoogleCloudTTSProvider.name);
  private client: textToSpeech.TextToSpeechClient;
  public readonly name = 'GoogleCloudTTS';

  constructor(
    private readonly formatter: SSMLFormatter,
    private readonly chunker: TextChunker,
  ) {
    this.client = new textToSpeech.TextToSpeechClient();
  }

  async generateAudio(
    text: string,
    voiceId: string = 'en-US-Neural2-D',
  ): Promise<Buffer> {
    const { SPEAKING_RATE, PITCH, AUDIO_ENCODING, CHUNK_SIZE } =
      VOICE_CONFIG_SETTINGS.GOOGLE_CLOUD;

    // Format text with SSML for storytelling prosody
    const ssmlText = this.formatter.format(text, {
      speed: String(SPEAKING_RATE),
    });

    // Google Cloud TTS limit is 5000 bytes per request — chunk at 4800 for safety
    const chunks = this.chunker.chunk(ssmlText, CHUNK_SIZE);
    const audioBuffers: Buffer[] = [];

    this.logger.log(
      `Splitting text into ${chunks.length} chunks for Google Cloud TTS`,
    );

    const languageCode = voiceId.split('-').slice(0, 2).join('-'); // e.g. "en-US" from "en-US-Neural2-D"

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkSSML = chunk.startsWith('<speak>')
        ? chunk
        : `<speak>${chunk}</speak>`;

      try {
        const [response] = await this.client.synthesizeSpeech({
          input: { ssml: chunkSSML },
          voice: {
            languageCode,
            name: voiceId,
          },
          audioConfig: {
            audioEncoding: AUDIO_ENCODING as 'MP3',
            speakingRate: SPEAKING_RATE,
            pitch: PITCH,
          },
        });

        if (!response.audioContent) {
          throw new Error('No audio content returned from Google Cloud TTS');
        }

        const buffer =
          response.audioContent instanceof Buffer
            ? response.audioContent
            : Buffer.from(response.audioContent as Uint8Array);

        audioBuffers.push(buffer);
      } catch (innerError) {
        this.logger.error(
          `Failed on chunk ${i + 1}: ${innerError.message}`,
        );
        throw innerError;
      }
    }

    return Buffer.concat(audioBuffers);
  }
}
