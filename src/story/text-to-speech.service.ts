import { createHash } from 'crypto';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import { UploadService } from '../upload/upload.service';
import {
  BadRequestException,
  Inject,
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
import { StyleTTS2TTSProvider } from '../voice/providers/styletts2-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { STORY_REPOSITORY, IStoryRepository } from './repositories';

import { VoiceQuotaService } from '../voice/voice-quota.service';
import {
  VOICE_CONFIG_SETTINGS,
  MAX_TTS_TEXT_LENGTH,
} from '../voice/voice.config';

/**
 * Normalize text for TTS providers by stripping literal quote characters
 * and collapsing whitespace. Without this, engines may read "quote" aloud.
 * Preserves contractions (don't, it's) and prosody-affecting punctuation.
 */
function preprocessTextForTTS(text: string): string {
  return (
    text
      // Remove double-quote variants (Unicode + ASCII)
      .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
      // Remove single-quote variants at word boundaries (preserves contractions)
      .replace(
        /(?<!\w)[\u2018\u2019\u201A\u201B']|[\u2018\u2019\u201A\u201B'](?!\w)/g,
        '',
      )
      // Collapse whitespace
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
    private readonly styleTts2Provider: StyleTTS2TTSProvider,
    private readonly edgeTtsProvider: EdgeTTSProvider,
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
    private readonly prisma: PrismaService,
    private readonly voiceQuota: VoiceQuotaService,
  ) {}

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex').substring(0, 64);
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
    try {
      const textHash = this.hashText(text);
      await this.prisma.paragraphAudioCache.upsert({
        where: {
          storyId_textHash_voiceId: { storyId, textHash, voiceId },
        },
        create: { storyId, textHash, voiceId, audioUrl },
        update: { audioUrl },
      });
    } catch (error) {
      const msg = ErrorHandler.extractMessage(error);
      this.logger.warn(
        `Failed to cache paragraph audio for story ${storyId}: ${msg}`,
      );
    }
  }

  async synthesizeStory(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string, // Allow string (UUID)
    userId?: string, // Added userId for quota tracking
  ): Promise<string> {
    // Guard against unbounded input
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      throw new BadRequestException(
        `Text exceeds maximum TTS length of ${MAX_TTS_TEXT_LENGTH} characters`,
      );
    }

    const cleanedText = preprocessTextForTTS(text);
    const type = voicetype ?? DEFAULT_VOICE;

    // Check paragraph-level cache first
    const cachedUrl = await this.getCachedParagraphAudio(
      storyId,
      cleanedText,
      type,
    );
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
      const voice = await this.storyRepository.findVoiceById(type);
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

    if (useElevenLabs && userId) {
      const allowed = await this.voiceQuota.checkUsage(userId);
      if (!allowed) {
        this.logger.log(
          `User ${userId} quota exceeded. Fallback to StyleTTS2.`,
        );
        useElevenLabs = false;
      }
    } else if (useElevenLabs && !userId) {
      this.logger.warn(
        `Anonymous request for ElevenLabs voice ${type}. Denying.`,
      );
      useElevenLabs = false;
    }

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

        const audioUrl = await this.uploadService.uploadAudioBuffer(
          audioBuffer,
          `story_${storyId}_elevenlabs_${Date.now()}.mp3`,
        );
        await this.cacheParagraphAudio(storyId, cleanedText, type, audioUrl);
        return audioUrl;
      } catch (error) {
        const msg = ErrorHandler.extractMessage(error);
        this.logger.warn(
          `ElevenLabs generation failed for story ${storyId}: ${msg}. Falling back to StyleTTS2.`,
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

    // Priority 2: StyleTTS2 Fallback
    try {
      this.logger.log(
        `Attempting StyleTTS2 generation for story ${storyId} with voice ${type}`,
      );

      const audioBuffer =
        await this.styleTts2Provider.generateAudio(cleanedText);
      const audioUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_styletts2_${Date.now()}.wav`,
      );
      await this.cacheParagraphAudio(storyId, cleanedText, type, audioUrl);
      return audioUrl;
    } catch (error) {
      const msg = ErrorHandler.extractMessage(error);
      this.logger.warn(
        `StyleTTS2 failed for story ${storyId}: ${msg}. Falling back to Edge TTS.`,
      );
    }

    // Priority 3: Edge TTS (final fallback)
    try {
      this.logger.log(
        `Attempting Edge TTS generation for story ${storyId} with voice ${type}`,
      );

      const audioBuffer = await this.edgeTtsProvider.generateAudio(cleanedText);
      const audioUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_edgetts_${Date.now()}.mp3`,
      );
      await this.cacheParagraphAudio(storyId, cleanedText, type, audioUrl);
      return audioUrl;
    } catch (error) {
      const msg = ErrorHandler.extractMessage(error);
      this.logger.error(
        `Edge TTS fallback failed for story ${storyId}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Voice generation failed on all providers',
      );
    }
  }
}
