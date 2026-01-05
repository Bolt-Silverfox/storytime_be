import { UploadService } from '../upload/upload.service';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@deepgram/sdk';
import { ElevenLabsClient } from 'elevenlabs';
import { VoiceType, VOICE_CONFIG } from '../voice/voice.dto';
import { Readable } from 'stream';

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);
  private deepgramApiKey: string;
  private elevenLabsApiKey: string;
  private elevenLabs: ElevenLabsClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly uploadService: UploadService,
  ) {
    this.deepgramApiKey = this.configService.get<string>('DEEPGRAM_API_KEY') ?? '';
    this.elevenLabsApiKey = this.configService.get<string>('ELEVEN_LABS_KEY') ?? '';

    if (this.elevenLabsApiKey) {
      try {
        this.elevenLabs = new ElevenLabsClient({ apiKey: this.elevenLabsApiKey });
      } catch (err) {
        this.logger.error(`Failed to initialize ElevenLabs client: ${err.message}`);
      }
    } else {
      this.logger.warn('ELEVEN_LABS_KEY is not set');
    }

    if (!this.deepgramApiKey) {
      this.logger.warn('DEEPGRAM_API_KEY is not set');
    }
  }

  async textToSpeechCloudUrl(
    storyId: string,
    text: string,
    voicetype?: VoiceType,
  ): Promise<string> {
    const type = voicetype ?? VoiceType.MILO;
    const voiceConfig = VOICE_CONFIG[type];

    // Priority 1: ElevenLabs
    if (this.elevenLabs && voiceConfig.elevenLabsId) {
      try {
        this.logger.log(`Attempting ElevenLabs generation for story ${storyId} with voice ${type} (${voiceConfig.elevenLabsId})`);
        return await this.textToSpeechElevenLabs(storyId, text, voiceConfig.elevenLabsId);
      } catch (error) {
        this.logger.warn(`ElevenLabs generation failed for story ${storyId}: ${error.message}. Falling back to Deepgram.`);
        // Proceed to fallback
      }
    } else {
      if (!this.elevenLabs) this.logger.debug('Skipping ElevenLabs: Client not initialized');
      else if (!voiceConfig.elevenLabsId) this.logger.debug(`Skipping ElevenLabs: No ID configured for voice ${type}`);
    }

    // Priority 2: Deepgram Fallback
    if (this.deepgramApiKey) {
      try {
        this.logger.log(`Attempting Deepgram generation for story ${storyId} with voice ${type}`);
        return await this.textToSpeechDeepgram(storyId, text, type);
      } catch (error) {
        this.logger.error(`Deepgram fallback failed for story ${storyId}: ${error.message}`);
        throw new InternalServerErrorException('Voice generation failed on both providers');
      }
    }

    throw new InternalServerErrorException('No voice generation provider available');
  }

  private async textToSpeechElevenLabs(
    storyId: string,
    text: string,
    voiceId: string,
  ): Promise<string> {
    try {
      const audioStream = await this.elevenLabs.textToSpeech.convert(voiceId, {
        text: text,
        model_id: 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128',
      });

      const audioBuffer = await this.streamToBuffer(audioStream);

      return await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_elevenlabs_${Date.now()}.mp3`,
      );
    } catch (error) {
      throw error; // Rethrow to be caught by fallback logic
    }
  }

  private async textToSpeechDeepgram(
    storyId: string,
    text: string,
    voicetype: VoiceType,
  ): Promise<string> {
    if (!this.deepgramApiKey) {
      throw new InternalServerErrorException('Deepgram API key is missing');
    }

    const voiceConfig = VOICE_CONFIG[voicetype];
    const deepgram = createClient(this.deepgramApiKey);

    // 1. Transform raw text into "Storyteller Mode" (SSML)
    const ssmlText = this.formatTextToSSML(text);

    try {
      this.logger.log(`Generating Audio with Deepgram Model: ${voiceConfig.model}`);

      // Deepgram has a 2000 char limit. Split text into chunks.
      const MAX_CHARS = 1900; // Safety margin
      const chunks = this.chunkText(ssmlText, MAX_CHARS);
      const audioBuffers: Buffer[] = [];

      this.logger.log(`Splitting text into ${chunks.length} chunks`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Ensure each chunk is wrapped in <speak> tags if not already
        const chunkSSML = chunk.startsWith('<speak>') ? chunk : `<speak>${chunk}</speak>`;

        this.logger.log(`Processing chunk ${i + 1}/${chunks.length} (Length: ${chunkSSML.length})`);

        try {
          const response = await deepgram.speak.request(
            { text: chunkSSML },
            {
              model: voiceConfig.model,
              encoding: 'linear16',
              container: 'wav',
            },
          );

          const stream = await response.getStream();
          if (!stream) {
            throw new Error('No audio stream returned from Deepgram');
          }
          audioBuffers.push(await this.getAudioBuffer(stream));
        } catch (innerError) {
          this.logger.error(`Failed on chunk ${i + 1}: ${innerError.message}`);
          throw innerError;
        }
      }

      const combinedBuffer = Buffer.concat(audioBuffers);

      return await this.uploadService.uploadAudioBuffer(
        combinedBuffer,
        `story_${storyId}_deepgram_${Date.now()}.wav`,
      );

    } catch (error) {
      this.logger.error(`Deepgram TTS failed for story ${storyId}: ${error.message}`);
      throw error;
    }
  }

  // --- Helper: Adds "Breathing Room" to the story ---
  private formatTextToSSML(rawText: string): string {
    // 1. Clean up weird spacing
    let text = rawText.replace(/\s+/g, ' ').trim();

    // 2. Escape special XML characters to prevent errors
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // 3. Add pauses for dramatic effect
    // Pause after commas (short breath)
    text = text.replace(/,/g, ', <break time="300ms"/>');

    // Pause after sentences (medium breath)
    text = text.replace(/([.!?])\s/g, '$1 <break time="800ms"/> ');

    // Long pause between paragraphs/ideas (if you have double newlines in raw text)
    text = text.replace(/\n\n/g, '<break time="1500ms"/>'); 

    // 4. Wrap in <speak> tags
    return `<speak>${text}</speak>`;
  }

  private chunkText(text: string, maxLength: number): string[] {
    // Remove outer <speak> tags for splitting, we'll add them back to chunks
    let cleanText = text.replace(/^<speak>/, '').replace(/<\/speak>$/, '');

    const chunks: string[] = [];
    while (cleanText.length > maxLength) {
      let splitIndex = cleanText.lastIndexOf(' ', maxLength);
      // Try to split at a sentence end if possible
      const sentenceEnd = cleanText.lastIndexOf('. ', maxLength);
      if (sentenceEnd > maxLength * 0.5) {
        splitIndex = sentenceEnd + 1;
      }

      if (splitIndex === -1) splitIndex = maxLength;

      chunks.push(cleanText.substring(0, splitIndex).trim());
      cleanText = cleanText.substring(splitIndex).trim();
    }
    if (cleanText.length > 0) {
      chunks.push(cleanText);
    }
    return chunks;
  }

  private async getAudioBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return Buffer.from(result.buffer);
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
