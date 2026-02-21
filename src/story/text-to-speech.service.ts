import { createHash } from 'crypto';
import { UploadService } from '../upload/upload.service';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { VoiceType } from '../voice/dto/voice.dto';
import {
  VOICE_CONFIG,
  DEFAULT_VOICE,
  VoiceSettings,
} from '../voice/voice.constants';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { GoogleCloudTTSProvider } from '../voice/providers/google-cloud-tts.provider';
import { PrismaService } from '../prisma/prisma.service';

import { VoiceQuotaService } from '../voice/voice-quota.service';
import { VOICE_CONFIG_SETTINGS } from '../voice/voice.config';

/**
 * Normalize text for TTS providers by stripping literal quote characters
 * and collapsing whitespace. Without this, engines may read "quote" aloud.
 * Preserves contractions (don't, it's) and prosody-affecting punctuation (.,!?…—).
 */
function preprocessTextForTTS(text: string): string {
  return (
    text
      // Remove double-quote variants (never used as apostrophes)
      .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
      // Remove single-quote variants only at word boundaries (preserves contractions: don't, it's, I'm)
      .replace(
        /(?<!\w)[\u2018\u2019\u201A\u201B']|[\u2018\u2019\u201A\u201B'](?!\w)/g,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly googleCloudProvider: GoogleCloudTTSProvider,
    private readonly prisma: PrismaService,
    private readonly voiceQuota: VoiceQuotaService,
  ) {}

  private hashText(text: string): string {
    const cleaned = preprocessTextForTTS(text);
    return createHash('sha256').update(cleaned).digest('hex');
  }

  private async getCachedParagraphAudio(
    storyId: string,
    text: string,
    voiceId: string,
  ): Promise<string | null> {
    const textHash = this.hashText(text);
    const cached = await this.prisma.paragraphAudioCache.findUnique({
      where: {
        storyId_textHash_voiceId: { storyId, textHash, voiceId },
      },
    });
    return cached?.audioUrl ?? null;
  }

  private async cacheParagraphAudio(
    storyId: string,
    text: string,
    voiceId: string,
    audioUrl: string,
  ): Promise<void> {
    const textHash = this.hashText(text);
    await this.prisma.paragraphAudioCache.upsert({
      where: {
        storyId_textHash_voiceId: { storyId, textHash, voiceId },
      },
      create: { storyId, textHash, voiceId, audioUrl },
      update: { audioUrl },
    });
  }

  async textToSpeechCloudUrl(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string, // Allow string (UUID)
    userId?: string, // Added userId for quota tracking
  ): Promise<string> {
    const type = voicetype ?? DEFAULT_VOICE;

    // Check paragraph-level cache first
    const cachedUrl = await this.getCachedParagraphAudio(storyId, text, type);
    if (cachedUrl) {
      this.logger.log(
        `Paragraph cache hit for story ${storyId}, voice ${type}`,
      );
      return cachedUrl;
    }

    // Resolve ElevenLabs ID and per-voice settings
    let elevenLabsId: string | undefined;
    let voiceSettings: VoiceSettings | undefined;

    // Check if it's a known System Voice (Enum)
    if (Object.values(VoiceType).includes(type as VoiceType)) {
      const config = VOICE_CONFIG[type as VoiceType];
      elevenLabsId = config.elevenLabsId;
      voiceSettings = config.voiceSettings;
    } else {
      // Assume dynamic UUID (Custom Voice)
      // Look up in DB
      const voice = await this.prisma.voice.findUnique({ where: { id: type } });
      if (voice && voice.elevenLabsVoiceId) {
        elevenLabsId = voice.elevenLabsVoiceId;
        // Custom voices use default settings optimized for storytelling
        voiceSettings = undefined;
      } else {
        // Unrecognized ID, fallback to default
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        elevenLabsId = defaultConfig.elevenLabsId;
        voiceSettings = defaultConfig.voiceSettings;
        this.logger.warn(
          `Voice ID ${type} not found. Falling back to default.`,
        );
      }
    }

    // Determine if we should use ElevenLabs based on ID presence AND Quota
    let useElevenLabs = !!elevenLabsId;

    // Free users skip ElevenLabs entirely — use Google Cloud TTS
    if (useElevenLabs && userId) {
      const isPremium = await this.voiceQuota.isPremiumUser(userId);
      if (!isPremium) {
        this.logger.log(`Free user ${userId}. Using Google Cloud TTS.`);
        useElevenLabs = false;
      } else {
        const allowed = await this.voiceQuota.checkUsage(userId);
        if (!allowed) {
          this.logger.log(
            `User ${userId} quota exceeded. Falling back to Google Cloud TTS.`,
          );
          useElevenLabs = false;
        }
      }
    } else if (useElevenLabs && !userId) {
      this.logger.warn(
        `Anonymous request for ElevenLabs voice ${type}. Denying.`,
      );
      useElevenLabs = false;
    }

    const cleanedText = preprocessTextForTTS(text);

    // Priority 1: ElevenLabs
    if (useElevenLabs && elevenLabsId) {
      try {
        const labsModel = VOICE_CONFIG_SETTINGS.MODELS.DEFAULT;
        // Use per-voice settings if available, otherwise fall back to defaults
        const settings: VoiceSettings = voiceSettings ?? {
          stability:
            VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.STABILITY,
          similarity_boost:
            VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.SIMILARITY_BOOST,
          style: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.STYLE,
          use_speaker_boost:
            VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS
              .USE_SPEAKER_BOOST,
        };

        this.logger.log(
          `Attempting ElevenLabs generation for story ${storyId} with voice ${type} (${elevenLabsId}) using model ${labsModel}`,
        );
        const audioBuffer = await this.elevenLabsProvider.generateAudio(
          cleanedText,
          elevenLabsId,
          labsModel,
          settings,
        );

        // Increment usage
        if (userId) {
          await this.voiceQuota.incrementUsage(userId);
        }

        const elAudioUrl = await this.uploadService.uploadAudioBuffer(
          audioBuffer,
          `story_${storyId}_elevenlabs_${Date.now()}.mp3`,
        );
        try {
          await this.cacheParagraphAudio(storyId, text, type, elAudioUrl);
        } catch (cacheErr) {
          this.logger.warn(
            `Failed to cache paragraph audio for story ${storyId}: ${cacheErr.message}`,
          );
        }
        return elAudioUrl;
      } catch (error) {
        this.logger.warn(
          `ElevenLabs generation failed for story ${storyId}: ${error.message}. Falling back to Google Cloud TTS.`,
        );
        // Proceed to fallback
      }
    } else {
      if (elevenLabsId) {
        this.logger.debug(
          `Skipping ElevenLabs: Quota exceeded or no user ID for voice ${type}`,
        );
      } else {
        this.logger.debug(
          `Skipping ElevenLabs: No ID configured for voice ${type}`,
        );
      }
    }

    // Priority 2: Google Cloud TTS Fallback
    try {
      this.logger.log(
        `Attempting Google Cloud TTS generation for story ${storyId} with voice ${type}`,
      );

      const googleVoice =
        VOICE_CONFIG[type as VoiceType]?.googleCloudVoice ?? 'en-US-Neural2-D';

      const audioBuffer = await this.googleCloudProvider.generateAudio(
        cleanedText,
        googleVoice,
      );
      const gcAudioUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_gcloud_${Date.now()}.mp3`,
      );
      try {
        await this.cacheParagraphAudio(storyId, text, type, gcAudioUrl);
      } catch (cacheErr) {
        this.logger.warn(
          `Failed to cache paragraph audio for story ${storyId}: ${cacheErr.message}`,
        );
      }
      return gcAudioUrl;
    } catch (error) {
      this.logger.error(
        `Google Cloud TTS fallback failed for story ${storyId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Voice generation failed on both providers',
      );
    }
  }
}
