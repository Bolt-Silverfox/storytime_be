import { UploadService } from '../upload/upload.service';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { VoiceType } from '../voice/dto/voice.dto';
import { VOICE_CONFIG, DEFAULT_VOICE, VoiceSettings } from '../voice/voice.constants';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';
import { PrismaService } from '../prisma/prisma.service';

import { VoiceQuotaService } from '../voice/voice-quota.service';
import { VOICE_CONFIG_SETTINGS } from '../voice/voice.config';

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly deepgramProvider: DeepgramTTSProvider,
    private readonly prisma: PrismaService,
    private readonly voiceQuota: VoiceQuotaService,
  ) { }

  async textToSpeechCloudUrl(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string, // Allow string (UUID)
    userId?: string, // Added userId for quota tracking
  ): Promise<string> {
    const type = voicetype ?? DEFAULT_VOICE;

    // Resolve ElevenLabs ID and per-voice settings
    let elevenLabsId: string | undefined;
    let model = 'aura-asteria-en'; // Default Deepgram model (Asteria)
    let voiceSettings: VoiceSettings | undefined;

    // Check if it's a known System Voice (Enum)
    if (Object.values(VoiceType).includes(type as VoiceType)) {
      const config = VOICE_CONFIG[type as VoiceType];
      elevenLabsId = config.elevenLabsId;
      model = config.model;
      voiceSettings = config.voiceSettings;
    } else {
      // Assume dynamic UUID (Custom Voice)
      // Look up in DB
      const voice = await this.prisma.voice.findUnique({ where: { id: type } });
      if (voice && voice.elevenLabsVoiceId) {
        elevenLabsId = voice.elevenLabsVoiceId;
        // Custom voices use default settings optimized for storytelling
        voiceSettings = undefined;
      } else if (voice?.type === 'deepgram') {
        // If we ever support custom deepgram voices
        // model = voice.externalId ...
      } else {
        // Unrecognized ID, fallback to default
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        elevenLabsId = defaultConfig.elevenLabsId;
        model = defaultConfig.model;
        voiceSettings = defaultConfig.voiceSettings;
        this.logger.warn(`Voice ID ${type} not found. Falling back to default.`);
      }
    }

    // Determine if we should use ElevenLabs based on ID presence AND Quota
    let useElevenLabs = !!elevenLabsId;

    if (useElevenLabs && userId) {
      const allowed = await this.voiceQuota.checkUsage(userId);
      if (!allowed) {
        this.logger.log(`User ${userId} quota exceeded. Fallback to Deepgram.`);
        useElevenLabs = false;
        // Fallback to Deepgram model
      }
    } else if (useElevenLabs && !userId) {
      this.logger.warn(`Anonymous request for ElevenLabs voice ${type}. Denying.`);
      useElevenLabs = false;
    }

    // Priority 1: ElevenLabs
    if (useElevenLabs && elevenLabsId) {
      try {
        const labsModel = VOICE_CONFIG_SETTINGS.MODELS.DEFAULT;
        // Use per-voice settings if available, otherwise fall back to defaults
        const settings: VoiceSettings = voiceSettings ?? {
          stability: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.STABILITY,
          similarity_boost: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.SIMILARITY_BOOST,
          style: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.STYLE,
          use_speaker_boost: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.USE_SPEAKER_BOOST,
        };

        this.logger.log(`Attempting ElevenLabs generation for story ${storyId} with voice ${type} (${elevenLabsId}) using model ${labsModel}`);
        const audioBuffer = await this.elevenLabsProvider.generateAudio(text, elevenLabsId, labsModel, settings);

        // Increment usage
        if (userId) {
          await this.voiceQuota.incrementUsage(userId);
        }

        return await this.uploadService.uploadAudioBuffer(
          audioBuffer,
          `story_${storyId}_elevenlabs_${Date.now()}.mp3`,
        );
      } catch (error) {
        this.logger.warn(`ElevenLabs generation failed for story ${storyId}: ${error.message}. Falling back to Deepgram.`);
        // Proceed to fallback
      }
    } else {
      if (elevenLabsId) {
        this.logger.debug(`Skipping ElevenLabs: Quota exceeded or no user ID for voice ${type}`);
      } else {
        this.logger.debug(`Skipping ElevenLabs: No ID configured for voice ${type}`);
      }
    }

    // Priority 2: Deepgram Fallback
    try {
      this.logger.log(`Attempting Deepgram generation for story ${storyId} with voice ${type}`);

      const deepgramSettings = {
        speed: VOICE_CONFIG_SETTINGS.DEEPGRAM.DEFAULT_SPEED, // Slower pace for storytelling
      };

      const audioBuffer = await this.deepgramProvider.generateAudio(text, undefined, model, deepgramSettings);
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
