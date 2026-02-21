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
import { StyleTTS2TTSProvider } from '../voice/providers/styletts2-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';

import { VoiceQuotaService } from '../voice/voice-quota.service';
import {
  VOICE_CONFIG_SETTINGS,
  MAX_TTS_TEXT_LENGTH,
} from '../voice/voice.config';

/**
 * Normalize text for TTS providers by stripping literal quote characters
 * and collapsing whitespace. Without this, engines may read "quote" aloud.
 * Preserves contractions (don't, it's) and prosody-affecting punctuation (.,!?…—).
 */
export function preprocessTextForTTS(text: string): string {
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
    private readonly styleTts2Provider: StyleTTS2TTSProvider,
    private readonly edgeTtsProvider: EdgeTTSProvider,
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

    // Guard against unbounded input
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      throw new InternalServerErrorException(
        `Text exceeds maximum TTS length of ${MAX_TTS_TEXT_LENGTH} characters`,
      );
    }

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
    let edgeTtsVoice: string | undefined;
    let styleTts2Voice: string | undefined;
    let voiceSettings: VoiceSettings | undefined;

    // Check if it's a known System Voice (Enum)
    if (Object.values(VoiceType).includes(type as VoiceType)) {
      const config = VOICE_CONFIG[type as VoiceType];
      elevenLabsId = config.elevenLabsId;
      edgeTtsVoice = config.edgeTtsVoice;
      styleTts2Voice = config.styleTts2Voice;
      voiceSettings = config.voiceSettings;
    } else {
      // Assume dynamic UUID (Custom Voice)
      const voice = await this.prisma.voice.findUnique({ where: { id: type } });
      if (voice && voice.elevenLabsVoiceId) {
        elevenLabsId = voice.elevenLabsVoiceId;
        voiceSettings = undefined;
        // Custom voices are ElevenLabs clones; use default voice for free-tier fallback
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        edgeTtsVoice = defaultConfig.edgeTtsVoice;
        styleTts2Voice = defaultConfig.styleTts2Voice;
      } else {
        // Unrecognized ID, fallback to default
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        elevenLabsId = defaultConfig.elevenLabsId;
        edgeTtsVoice = defaultConfig.edgeTtsVoice;
        styleTts2Voice = defaultConfig.styleTts2Voice;
        voiceSettings = defaultConfig.voiceSettings;
        this.logger.warn(
          `Voice ID ${type} not found. Falling back to default.`,
        );
      }
    }

    // Determine if we should use ElevenLabs
    let useElevenLabs = !!elevenLabsId;

    if (useElevenLabs && userId) {
      // Premium gate: free users skip ElevenLabs entirely
      const isPremium = await this.voiceQuota.isPremiumUser(userId);
      if (!isPremium) {
        this.logger.log(`Free user ${userId}. Skipping ElevenLabs.`);
        useElevenLabs = false;
      } else {
        const allowed = await this.voiceQuota.checkUsage(userId);
        if (!allowed) {
          this.logger.log(
            `User ${userId} quota exceeded. Skipping ElevenLabs.`,
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

    // Priority 1: ElevenLabs (premium users only)
    if (useElevenLabs && elevenLabsId) {
      try {
        const labsModel = VOICE_CONFIG_SETTINGS.MODELS.DEFAULT;
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
          const cacheMsg =
            cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
          this.logger.warn(
            `Failed to cache paragraph audio for story ${storyId}: ${cacheMsg}`,
          );
        }
        return elAudioUrl;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `ElevenLabs generation failed for story ${storyId}: ${msg}. Falling back to StyleTTS2.`,
        );
      }
    }

    // Priority 2: StyleTTS2
    try {
      this.logger.log(
        `Attempting StyleTTS2 generation for story ${storyId} with voice ${styleTts2Voice ?? 'default'}`,
      );

      const audioBuffer = await this.styleTts2Provider.generateAudio(
        cleanedText,
        styleTts2Voice,
      );
      const stAudioUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_styletts2_${Date.now()}.wav`,
      );
      try {
        await this.cacheParagraphAudio(storyId, text, type, stAudioUrl);
      } catch (cacheErr) {
        const cacheMsg =
          cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
        this.logger.warn(
          `Failed to cache paragraph audio for story ${storyId}: ${cacheMsg}`,
        );
      }
      return stAudioUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `StyleTTS2 failed for story ${storyId}: ${msg}. Falling back to Edge TTS.`,
      );
    }

    // Priority 3: Edge TTS (final fallback)
    try {
      this.logger.log(
        `Attempting Edge TTS generation for story ${storyId} with voice ${edgeTtsVoice ?? 'default'}`,
      );

      const audioBuffer = await this.edgeTtsProvider.generateAudio(
        cleanedText,
        edgeTtsVoice,
      );
      const edgeAudioUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_edgetts_${Date.now()}.mp3`,
      );
      try {
        await this.cacheParagraphAudio(storyId, text, type, edgeAudioUrl);
      } catch (cacheErr) {
        const cacheMsg =
          cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
        this.logger.warn(
          `Failed to cache paragraph audio for story ${storyId}: ${cacheMsg}`,
        );
      }
      return edgeAudioUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Edge TTS fallback failed for story ${storyId}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Voice generation failed on all providers',
      );
    }
  }
}
