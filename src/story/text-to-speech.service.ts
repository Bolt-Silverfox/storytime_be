import { UploadService } from '../upload/upload.service';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { VoiceType, VOICE_CONFIG } from '../voice/voice.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly deepgramProvider: DeepgramTTSProvider,
  ) { }

  async textToSpeechCloudUrl(
    storyId: string,
    text: string,
    voicetype?: VoiceType,
  ): Promise<string> {
    const type = voicetype ?? VoiceType.MILO;
    const voiceConfig = VOICE_CONFIG[type];

    // Priority 1: ElevenLabs
    if (voiceConfig.elevenLabsId) {
      try {
        this.logger.log(`Attempting ElevenLabs generation for story ${storyId} with voice ${type} (${voiceConfig.elevenLabsId})`);
        const audioBuffer = await this.elevenLabsProvider.generateAudio(text, voiceConfig.elevenLabsId);
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
      const audioBuffer = await this.deepgramProvider.generateAudio(text, undefined, voiceConfig.model);
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
