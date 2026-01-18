import { UploadService } from '../upload/upload.service';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { VoiceType } from '../voice/voice.dto';
import { VOICE_CONFIG, DEFAULT_VOICE } from '../voice/voice.constants';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly deepgramProvider: DeepgramTTSProvider,
    private readonly prisma: PrismaService,
  ) { }

  async textToSpeechCloudUrl(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string, // Allow string (UUID)
  ): Promise<string> {
    const type = voicetype ?? DEFAULT_VOICE;

    // Resolve ElevenLabs ID
    let elevenLabsId: string | undefined;
    let model = 'aura-asteria-en'; // Default Deepgram model (Asteria)

    // Check if it's a known System Voice (Enum)
    if (Object.values(VoiceType).includes(type as VoiceType)) {
      const config = VOICE_CONFIG[type as VoiceType];
      elevenLabsId = config.elevenLabsId;
      model = config.model;
    } else {
      // Assume dynamic UUID (Custom Voice)
      // Look up in DB
      const voice = await this.prisma.voice.findUnique({ where: { id: type } });
      if (voice && voice.elevenLabsVoiceId) {
        elevenLabsId = voice.elevenLabsVoiceId;
        // No deepgram model for custom ElevenLabs voices usually, so deepgram fallback might just use default
      } else if (voice?.type === 'deepgram') {
        // If we ever support custom deepgram voices
        // model = voice.externalId ...
      } else {
        // Unrecognized ID, fallback to default? Or error?
        // Fallback to default
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        elevenLabsId = defaultConfig.elevenLabsId;
        model = defaultConfig.model;
        this.logger.warn(`Voice ID ${type} not found. Falling back to default.`);
      }
    }

    // Priority 1: ElevenLabs
    if (elevenLabsId) {
      try {
        this.logger.log(`Attempting ElevenLabs generation for story ${storyId} with voice ${type} (${elevenLabsId})`);
        const audioBuffer = await this.elevenLabsProvider.generateAudio(text, elevenLabsId);
        return await this.uploadService.uploadAudioBuffer(
          audioBuffer,
          `story_${storyId}_elevenlabs_${Date.now()}.mp3`,
        );
      } catch (error) {
        this.logger.warn(`ElevenLabs generation failed for story ${storyId}: ${error.message}. Falling back to Deepgram.`);
        // Proceed to fallback
      }
    } else {
      this.logger.debug(`Skipping ElevenLabs: No ID configured for voice ${type}`);
    }

    // Priority 2: Deepgram Fallback
    try {
      this.logger.log(`Attempting Deepgram generation for story ${storyId} with voice ${type}`);
      const audioBuffer = await this.deepgramProvider.generateAudio(text, undefined, model);
      return await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_deepgram_${Date.now()}.wav`,
      );
    } catch (error) {
      this.logger.error(`Deepgram fallback failed for story ${storyId}: ${error.message}`);
      throw new InternalServerErrorException('Voice generation failed on both providers');
    }
  }
}
