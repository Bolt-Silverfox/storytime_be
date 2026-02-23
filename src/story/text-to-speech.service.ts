import { createHash } from 'crypto';
import { UploadService } from '../upload/upload.service';
import {
  BadRequestException,
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
import { SubscriptionService } from '../subscription/subscription.service';
import {
  VOICE_CONFIG_SETTINGS,
  MAX_TTS_TEXT_LENGTH,
} from '../voice/voice.config';
import { splitByWordCountPreservingSentences } from '../voice/utils/paragraph-splitter';

/** Must match mobile StoryContentContainer's wordsPerChunk */
const WORDS_PER_CHUNK = 30;
/** Max concurrent TTS provider calls in a batch */
const MAX_CONCURRENT = 5;
/** Max paragraphs allowed in a single batch request */
const MAX_BATCH_PARAGRAPHS = 50;

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
    private readonly subscriptionService: SubscriptionService,
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
    voicetype?: VoiceType | string,
    userId?: string,
    options?: { skipQuotaCheck?: boolean; isPremium?: boolean },
  ): Promise<string> {
    const type = voicetype ?? DEFAULT_VOICE;

    // Guard against unbounded input
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      throw new BadRequestException(
        `Text exceeds maximum TTS length of ${MAX_TTS_TEXT_LENGTH} characters`,
      );
    }

    // Check paragraph-level cache first
    const cachedUrl = await this.getCachedParagraphAudio(storyId, text, type);
    if (cachedUrl) {
      this.logger.debug(
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
      const isPremium =
        options?.isPremium ??
        (await this.subscriptionService.isPremiumUser(userId));
      if (!isPremium) {
        this.logger.log(`Free user ${userId}. Skipping ElevenLabs.`);
        useElevenLabs = false;
      } else if (!options?.skipQuotaCheck) {
        // Per-call quota check (skipped in batch mode where quota is reserved upfront)
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

        if (userId && !options?.skipQuotaCheck) {
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

  async batchTextToSpeechCloudUrls(
    storyId: string,
    fullText: string,
    voiceType?: VoiceType | string,
    userId?: string,
  ): Promise<Array<{ index: number; text: string; audioUrl: string | null }>> {
    if (!fullText?.trim()) return [];

    const type = voiceType ?? DEFAULT_VOICE;
    const allParagraphs = splitByWordCountPreservingSentences(
      fullText,
      WORDS_PER_CHUNK,
    );

    if (allParagraphs.length > MAX_BATCH_PARAGRAPHS) {
      this.logger.warn(
        `Story ${storyId} has ${allParagraphs.length} paragraphs, capping at ${MAX_BATCH_PARAGRAPHS}`,
      );
    }
    const paragraphs = allParagraphs.slice(0, MAX_BATCH_PARAGRAPHS);

    // Pre-check cache with a single bulk query instead of N individual lookups
    const hashMap = new Map(
      paragraphs.map((text, index) => [this.hashText(text), { index, text }]),
    );
    const cachedEntries = await this.prisma.paragraphAudioCache.findMany({
      where: {
        storyId,
        voiceId: type,
        textHash: { in: [...hashMap.keys()] },
      },
    });
    const cacheMap = new Map(
      cachedEntries.map((e) => [e.textHash, e.audioUrl]),
    );

    const cached: Array<{ index: number; text: string; audioUrl: string }> = [];
    const uncached: Array<{ index: number; text: string }> = [];
    for (const [hash, { index, text }] of hashMap) {
      const cachedUrl = cacheMap.get(hash);
      if (cachedUrl) {
        cached.push({ index, text, audioUrl: cachedUrl });
      } else {
        uncached.push({ index, text });
      }
    }

    this.logger.log(
      `Batch story ${storyId}: ${cached.length} cached, ${uncached.length} to generate`,
    );

    if (uncached.length === 0) {
      return cached.sort((a, b) => a.index - b.index);
    }

    // Resolve premium status once for the entire batch
    let reservedCredits = 0;
    let isPremium = false;
    if (userId) {
      isPremium = await this.subscriptionService.isPremiumUser(userId);
      if (isPremium) {
        reservedCredits = await this.voiceQuota.checkAndReserveUsage(
          userId,
          uncached.length,
        );
        this.logger.log(
          `Reserved ${reservedCredits}/${uncached.length} ElevenLabs credits for batch story ${storyId}`,
        );
      }
    }

    // Generate uncached paragraphs in batches of MAX_CONCURRENT.
    // Only skip per-call quota for paragraphs within the reserved budget.
    const generated: Array<{
      index: number;
      text: string;
      audioUrl: string | null;
    }> = [];
    let reservedUsed = 0;

    for (let i = 0; i < uncached.length; i += MAX_CONCURRENT) {
      const batch = uncached.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(async ({ index, text }, batchIndex) => {
          const seqPos = i + batchIndex;
          const withinReserved = isPremium && seqPos < reservedCredits;
          try {
            const audioUrl = await this.textToSpeechCloudUrl(
              storyId,
              text,
              voiceType,
              userId,
              { skipQuotaCheck: withinReserved, isPremium },
            );
            return { index, text, audioUrl };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Batch TTS failed for paragraph ${index} of story ${storyId}: ${msg}`,
            );
            return { index, text, audioUrl: null };
          }
        }),
      );

      // Count how many reserved-budget paragraphs actually used ElevenLabs
      // (URL filename encodes provider: _elevenlabs_, _styletts2_, _edgetts_)
      for (let j = 0; j < batch.length; j++) {
        const seqPos = i + j;
        const url = batchResults[j].audioUrl;
        if (
          isPremium &&
          seqPos < reservedCredits &&
          url?.includes('_elevenlabs_')
        ) {
          reservedUsed++;
        }
      }

      generated.push(...batchResults);
    }

    // Release unused reserved credits — only paragraphs that actually used
    // ElevenLabs (identified by URL filename pattern) keep their reserved credits.
    // This prevents quota leaks when ElevenLabs fails but a fallback succeeds.
    const creditsToRelease = reservedCredits - reservedUsed;
    if (creditsToRelease > 0 && userId) {
      await this.voiceQuota.releaseReservedUsage(userId, creditsToRelease);
    }

    return [...cached, ...generated].sort((a, b) => a.index - b.index);
  }
}
