import { createHash } from 'crypto';
import { UploadService } from '../upload/upload.service';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../voice/dto/voice.dto';
import {
  VOICE_CONFIG,
  DEFAULT_VOICE,
  VoiceSettings,
} from '../voice/voice.constants';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';

import { VoiceQuotaService } from '../voice/voice-quota.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  CircuitBreakerService,
  CircuitBreaker,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';
import { TTS_CIRCUIT_BREAKER_CONFIG } from '@/shared/constants/circuit-breaker.constants';
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

/** Internal result from TTS generation including which provider was used */
interface TTSResult {
  audioUrl: string;
  provider: 'elevenlabs' | 'deepgram' | 'edgetts' | 'cache';
}

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
  private readonly elevenLabsBreaker: CircuitBreaker;
  private readonly deepgramBreaker: CircuitBreaker;
  private readonly edgeTtsBreaker: CircuitBreaker;

  constructor(
    private readonly uploadService: UploadService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly deepgramProvider: DeepgramTTSProvider,
    private readonly edgeTtsProvider: EdgeTTSProvider,
    private readonly prisma: PrismaService,
    private readonly voiceQuota: VoiceQuotaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly cbService: CircuitBreakerService,
  ) {
    this.elevenLabsBreaker = this.cbService.getBreaker(
      'elevenlabs',
      TTS_CIRCUIT_BREAKER_CONFIG.elevenlabs,
    );
    this.deepgramBreaker = this.cbService.getBreaker(
      'deepgram',
      TTS_CIRCUIT_BREAKER_CONFIG.deepgram,
    );
    this.edgeTtsBreaker = this.cbService.getBreaker(
      'edgetts',
      TTS_CIRCUIT_BREAKER_CONFIG.edgetts,
    );
  }

  /** Get the circuit breaker for a given provider name */
  private getBreakerForProvider(
    provider: 'elevenlabs' | 'deepgram' | 'edgetts',
  ): CircuitBreaker {
    switch (provider) {
      case 'elevenlabs':
        return this.elevenLabsBreaker;
      case 'deepgram':
        return this.deepgramBreaker;
      case 'edgetts':
        return this.edgeTtsBreaker;
    }
  }

  /**
   * Resolve any voice identifier (VoiceType enum, UUID, or unknown) to its
   * canonical ElevenLabs voice ID for consistent quota/lock checks.
   * Falls back to DEFAULT_VOICE if the ID cannot be resolved.
   */
  private async resolveCanonicalVoiceId(type: string): Promise<string> {
    const canonical = await this.voiceQuota.resolveCanonicalVoiceId(type);
    // If voiceQuota returned the input unchanged and it's not an ElevenLabs ID
    // we recognise, fall back to the default voice.
    if (canonical === type && !this.isKnownElevenLabsId(canonical)) {
      return VOICE_CONFIG[DEFAULT_VOICE].elevenLabsId;
    }
    return canonical;
  }

  /** Check if a string matches any known ElevenLabs voice ID */
  private isKnownElevenLabsId(id: string): boolean {
    return Object.values(VOICE_CONFIG).some((c) => c.elevenLabsId === id);
  }

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
    const cached = await this.prisma.paragraphAudioCache.findFirst({
      where: { storyId, textHash, voiceId },
    });
    return cached?.audioUrl ?? null;
  }

  private async cacheParagraphAudio(
    storyId: string,
    text: string,
    voiceId: string,
    audioUrl: string,
    provider: string,
  ): Promise<void> {
    const textHash = this.hashText(text);
    await this.prisma.paragraphAudioCache.upsert({
      where: {
        storyId_textHash_voiceId_provider: { storyId, textHash, voiceId, provider },
      },
      create: { storyId, textHash, voiceId, audioUrl, provider },
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
    const result = await this.generateTTS(
      storyId,
      text,
      voicetype,
      userId,
      options,
    );
    return result.audioUrl;
  }

  /**
   * Internal TTS generation that tracks which provider was used.
   * When `providerOverride` is set, only that provider is attempted
   * (no fallback chain). Used by batch mode to ensure voice consistency.
   */
  private async generateTTS(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string,
    userId?: string,
    options?: {
      skipQuotaCheck?: boolean;
      isPremium?: boolean;
      providerOverride?: 'elevenlabs' | 'deepgram' | 'edgetts';
    },
  ): Promise<TTSResult> {
    const type =
      VOICE_TYPE_MIGRATION_MAP[voicetype as string] ??
      voicetype ??
      DEFAULT_VOICE;

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
      return { audioUrl: cachedUrl, provider: 'cache' };
    }

    // Resolve ElevenLabs ID and per-voice settings
    let elevenLabsId: string | undefined;
    let edgeTtsVoice: string | undefined;
    let deepgramVoice: string | undefined;
    let voiceSettings: VoiceSettings | undefined;

    // Check if it's a known System Voice (Enum)
    if (Object.values(VoiceType).includes(type)) {
      const config = VOICE_CONFIG[type];
      elevenLabsId = config.elevenLabsId;
      edgeTtsVoice = config.edgeTtsVoice;
      deepgramVoice = config.deepgramVoice;
      voiceSettings = config.voiceSettings;
    } else if (VOICE_TYPE_MIGRATION_MAP[type]) {
      // Old enum name (e.g. CHARLIE) — resolve via migration map
      const config = VOICE_CONFIG[VOICE_TYPE_MIGRATION_MAP[type]];
      elevenLabsId = config.elevenLabsId;
      edgeTtsVoice = config.edgeTtsVoice;
      deepgramVoice = config.deepgramVoice;
      voiceSettings = config.voiceSettings;
    } else {
      // Assume dynamic UUID (Custom Voice) — try DB lookup first
      const voice = await this.prisma.voice.findFirst({
        where: {
          OR: [{ id: type }, { name: type }],
          isDeleted: false,
        },
      });
      if (voice && voice.elevenLabsVoiceId) {
        elevenLabsId = voice.elevenLabsVoiceId;
        voiceSettings = undefined;
        // Custom voices are ElevenLabs clones; use default voice for free-tier fallback
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        edgeTtsVoice = defaultConfig.edgeTtsVoice;
        deepgramVoice = defaultConfig.deepgramVoice;
      } else {
        // Unrecognized ID, fallback to default
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        elevenLabsId = defaultConfig.elevenLabsId;
        edgeTtsVoice = defaultConfig.edgeTtsVoice;
        deepgramVoice = defaultConfig.deepgramVoice;
        voiceSettings = defaultConfig.voiceSettings;
        this.logger.warn(
          `Voice ID ${type} not found. Falling back to default.`,
        );
      }
    }

    // Determine if we should use ElevenLabs
    let useElevenLabs = !!elevenLabsId;

    if (useElevenLabs && elevenLabsId && userId) {
      const isPremium =
        options?.isPremium ??
        (await this.subscriptionService.isPremiumUser(userId));
      if (isPremium && !options?.skipQuotaCheck) {
        // Premium: per-story voice limit (cached voices don't count)
        const voiceAllowed = await this.voiceQuota.canUseVoiceForStory(
          storyId,
          elevenLabsId,
        );
        if (!voiceAllowed) {
          this.logger.log(
            `Story ${storyId} has reached the premium voice limit. Skipping ElevenLabs for voice ${type}.`,
          );
          useElevenLabs = false;
        }
      } else if (!isPremium) {
        // Free user: allow ElevenLabs only for their one trial story
        const trialAllowed = await this.voiceQuota.canFreeUserUseElevenLabs(
          userId,
          elevenLabsId,
          storyId,
        );
        if (!trialAllowed) {
          this.logger.debug(
            `Free user ${userId}: ElevenLabs trial not available for story ${storyId}, using Deepgram/Edge TTS.`,
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
    const override = options?.providerOverride;

    // Helper: attempt a single provider, cache on success, return result
    const attemptProvider = async (
      providerName: TTSResult['provider'],
      generate: () => Promise<Buffer>,
    ): Promise<TTSResult> => {
      const audioBuffer = await generate();
      const audioUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${storyId}_${providerName}_${Date.now()}.mp3`,
      );
      try {
        await this.cacheParagraphAudio(
          storyId,
          text,
          type,
          audioUrl,
          providerName,
        );
      } catch (cacheErr) {
        const cacheMsg =
          cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
        this.logger.warn(
          `Failed to cache paragraph audio for story ${storyId}: ${cacheMsg}`,
        );
      }
      return { audioUrl, provider: providerName };
    };

    // When providerOverride is set, only try that provider and throw on failure
    // (no fallback chain). This is used by batch mode for voice consistency.
    // Honour the quota decision: if ElevenLabs was denied, don't bypass via override.
    if (override) {
      if (override === 'elevenlabs' && !useElevenLabs) {
        throw new InternalServerErrorException(
          'ElevenLabs quota exhausted for this request',
        );
      }
      return this.attemptSingleProvider(
        override,
        storyId,
        type,
        cleanedText,
        elevenLabsId,
        deepgramVoice,
        edgeTtsVoice,
        voiceSettings,
        attemptProvider,
      );
    }

    // Normal mode: full fallback chain with circuit breaker checks

    // Priority 1: ElevenLabs (premium users only)
    if (useElevenLabs && elevenLabsId) {
      if (!this.elevenLabsBreaker.canExecute()) {
        this.logger.warn(
          `ElevenLabs circuit breaker OPEN for story ${storyId}. Skipping to Deepgram.`,
        );
      } else {
        try {
          const result = await this.tryElevenLabs(
            storyId,
            cleanedText,
            elevenLabsId,
            type,
            voiceSettings,
            attemptProvider,
          );
          this.elevenLabsBreaker.recordSuccess();
          return result;
        } catch (error) {
          this.elevenLabsBreaker.recordFailure(error);
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `ElevenLabs generation failed for story ${storyId}: ${msg}. Falling back to Deepgram.`,
          );
        }
      }
    }

    // Priority 2: Deepgram TTS
    if (!this.deepgramBreaker.canExecute()) {
      this.logger.warn(
        `Deepgram circuit breaker OPEN for story ${storyId}. Skipping to Edge TTS.`,
      );
    } else {
      try {
        const result = await this.tryDeepgram(
          storyId,
          cleanedText,
          deepgramVoice,
          attemptProvider,
        );
        this.deepgramBreaker.recordSuccess();
        return result;
      } catch (error) {
        this.deepgramBreaker.recordFailure(error);
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Deepgram TTS failed for story ${storyId}: ${msg}. Falling back to Edge TTS.`,
        );
      }
    }

    // Priority 3: Edge TTS (final fallback)
    if (!this.edgeTtsBreaker.canExecute()) {
      this.logger.error(
        `All TTS circuit breakers OPEN for story ${storyId}. No provider available.`,
      );
      throw new InternalServerErrorException(
        'Voice generation failed on all providers',
      );
    }
    try {
      const result = await this.tryEdgeTts(
        storyId,
        cleanedText,
        edgeTtsVoice,
        attemptProvider,
      );
      this.edgeTtsBreaker.recordSuccess();
      return result;
    } catch (error) {
      this.edgeTtsBreaker.recordFailure(error);
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Edge TTS fallback failed for story ${storyId}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Voice generation failed on all providers',
      );
    }
  }

  /** Try ElevenLabs provider */
  private async tryElevenLabs(
    storyId: string,
    cleanedText: string,
    elevenLabsId: string,
    type: string,
    voiceSettings: VoiceSettings | undefined,
    attemptProvider: (
      name: TTSResult['provider'],
      gen: () => Promise<Buffer>,
    ) => Promise<TTSResult>,
  ): Promise<TTSResult> {
    const labsModel = VOICE_CONFIG_SETTINGS.MODELS.DEFAULT;
    const settings: VoiceSettings = voiceSettings ?? {
      stability: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.STABILITY,
      similarity_boost:
        VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.SIMILARITY_BOOST,
      style: VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.STYLE,
      use_speaker_boost:
        VOICE_CONFIG_SETTINGS.ELEVEN_LABS.DEFAULT_SETTINGS.USE_SPEAKER_BOOST,
    };

    this.logger.log(
      `Attempting ElevenLabs generation for story ${storyId} with voice ${type} (${elevenLabsId}) using model ${labsModel}`,
    );
    const result = await attemptProvider('elevenlabs', () =>
      this.elevenLabsProvider.generateAudio(
        cleanedText,
        elevenLabsId,
        labsModel,
        settings,
      ),
    );

    return result;
  }

  /** Try Deepgram provider */
  private async tryDeepgram(
    storyId: string,
    cleanedText: string,
    deepgramVoice: string | undefined,
    attemptProvider: (
      name: TTSResult['provider'],
      gen: () => Promise<Buffer>,
    ) => Promise<TTSResult>,
  ): Promise<TTSResult> {
    this.logger.log(
      `Attempting Deepgram TTS generation for story ${storyId} with voice ${deepgramVoice ?? 'default'}`,
    );
    return attemptProvider('deepgram', () =>
      this.deepgramProvider.generateAudio(cleanedText, deepgramVoice),
    );
  }

  /** Try Edge TTS provider */
  private async tryEdgeTts(
    storyId: string,
    cleanedText: string,
    edgeTtsVoice: string | undefined,
    attemptProvider: (
      name: TTSResult['provider'],
      gen: () => Promise<Buffer>,
    ) => Promise<TTSResult>,
  ): Promise<TTSResult> {
    this.logger.log(
      `Attempting Edge TTS generation for story ${storyId} with voice ${edgeTtsVoice ?? 'default'}`,
    );
    return attemptProvider('edgetts', () =>
      this.edgeTtsProvider.generateAudio(cleanedText, edgeTtsVoice),
    );
  }

  /**
   * Attempt a single provider without fallback (used when providerOverride is set).
   * Throws on failure instead of falling through to next provider.
   * Records success/failure on the circuit breaker for the provider.
   */
  private async attemptSingleProvider(
    provider: 'elevenlabs' | 'deepgram' | 'edgetts',
    storyId: string,
    type: string,
    cleanedText: string,
    elevenLabsId: string | undefined,
    deepgramVoice: string | undefined,
    edgeTtsVoice: string | undefined,
    voiceSettings: VoiceSettings | undefined,
    attemptProvider: (
      name: TTSResult['provider'],
      gen: () => Promise<Buffer>,
    ) => Promise<TTSResult>,
  ): Promise<TTSResult> {
    const breaker = this.getBreakerForProvider(provider);

    if (!breaker.canExecute()) {
      throw new InternalServerErrorException(
        `${provider} circuit breaker is OPEN`,
      );
    }

    try {
      let result: TTSResult;
      switch (provider) {
        case 'elevenlabs': {
          if (!elevenLabsId) {
            throw new InternalServerErrorException(
              `No ElevenLabs voice ID available for voice ${type}`,
            );
          }
          result = await this.tryElevenLabs(
            storyId,
            cleanedText,
            elevenLabsId,
            type,
            voiceSettings,
            attemptProvider,
          );
          break;
        }
        case 'deepgram':
          result = await this.tryDeepgram(
            storyId,
            cleanedText,
            deepgramVoice,
            attemptProvider,
          );
          break;
        case 'edgetts':
          result = await this.tryEdgeTts(
            storyId,
            cleanedText,
            edgeTtsVoice,
            attemptProvider,
          );
          break;
        default: {
          const _exhaustiveCheck: never = provider;
          void _exhaustiveCheck;
          throw new InternalServerErrorException('Unknown TTS provider');
        }
      }
      breaker.recordSuccess();
      return result;
    } catch (error) {
      breaker.recordFailure(error);
      throw error;
    }
  }

  async batchTextToSpeechCloudUrls(
    storyId: string,
    fullText: string,
    voiceType?: VoiceType | string,
    userId?: string,
  ): Promise<{
    results: Array<{ index: number; text: string; audioUrl: string | null }>;
    totalParagraphs: number;
    wasTruncated: boolean;
    usedProvider: 'elevenlabs' | 'deepgram' | 'edgetts';
    preferredProvider?: 'elevenlabs' | 'deepgram' | 'edgetts';
    providerStatus?: 'degraded';
  }> {
    if (!fullText?.trim())
      return {
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
        usedProvider: 'deepgram',
      };

    const type =
      VOICE_TYPE_MIGRATION_MAP[voiceType as string] ??
      voiceType ??
      DEFAULT_VOICE;
    const allParagraphs = splitByWordCountPreservingSentences(
      fullText,
      WORDS_PER_CHUNK,
    );

    const wasTruncated = allParagraphs.length > MAX_BATCH_PARAGRAPHS;
    if (wasTruncated) {
      this.logger.warn(
        `Story ${storyId} has ${allParagraphs.length} paragraphs, capping at ${MAX_BATCH_PARAGRAPHS}`,
      );
    }
    const paragraphs = allParagraphs.slice(0, MAX_BATCH_PARAGRAPHS);

    // Pre-check cache with a single bulk query instead of N individual lookups.
    // Group by hash to handle duplicate paragraph text (e.g. repeated refrains).
    const hashMap = new Map<string, Array<{ index: number; text: string }>>();
    for (let idx = 0; idx < paragraphs.length; idx++) {
      const hash = this.hashText(paragraphs[idx]);
      const entries = hashMap.get(hash) ?? [];
      entries.push({ index: idx, text: paragraphs[idx] });
      hashMap.set(hash, entries);
    }

    // ── Determine the batch provider BEFORE cache lookup ──
    // This ensures we only use cache hits from the same provider,
    // guaranteeing every paragraph in the story sounds the same.
    const quotaVoiceId = await this.resolveCanonicalVoiceId(type);
    let isPremium = false;
    let useElevenLabsBatch = false;
    if (userId) {
      isPremium = await this.subscriptionService.isPremiumUser(userId);
      if (isPremium) {
        useElevenLabsBatch = await this.voiceQuota.canUseVoiceForStory(
          storyId,
          quotaVoiceId,
        );
        if (!useElevenLabsBatch) {
          this.logger.log(
            `Story ${storyId} has reached the premium voice limit. Skipping ElevenLabs for voice ${type}.`,
          );
        }
      } else {
        // Free user: allow ElevenLabs only for their one trial story
        useElevenLabsBatch = await this.voiceQuota.canFreeUserUseElevenLabs(
          userId,
          quotaVoiceId,
          storyId,
        );
        if (!useElevenLabsBatch) {
          this.logger.debug(
            `Free user ${userId}: ElevenLabs trial not available for batch story ${storyId}, using Deepgram/Edge TTS.`,
          );
        }
      }
    }

    // Pick the single provider for this batch.
    // Circuit breaker fast-fail: if the preferred provider is OPEN, downgrade.
    let batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts' =
      useElevenLabsBatch ? 'elevenlabs' : 'deepgram';

    if (
      batchProvider === 'elevenlabs' &&
      !this.elevenLabsBreaker.canExecute()
    ) {
      this.logger.warn(
        `ElevenLabs circuit breaker OPEN for batch story ${storyId}. Downgrading to Deepgram.`,
      );
      batchProvider = 'deepgram';
    }
    if (batchProvider === 'deepgram' && !this.deepgramBreaker.canExecute()) {
      this.logger.warn(
        `Deepgram circuit breaker OPEN for batch story ${storyId}. Downgrading to Edge TTS.`,
      );
      batchProvider = 'edgetts';
    }

    // ── Cache lookup: only accept hits from the SAME provider ──
    // Paragraphs cached by a different provider are treated as uncached
    // so they get regenerated, ensuring consistent voice across the story.
    const cachedEntries = await this.prisma.paragraphAudioCache.findMany({
      where: {
        storyId,
        voiceId: type,
        provider: batchProvider,
        textHash: { in: [...hashMap.keys()] },
      },
    });
    const cacheMap = new Map(
      cachedEntries.map((e) => [e.textHash, e.audioUrl]),
    );

    let cached: Array<{ index: number; text: string; audioUrl: string }> = [];
    let uncached: Array<{ index: number; text: string; hash: string }> = [];
    let uncachedHashes = new Set<string>();

    for (const [hash, entries] of hashMap) {
      const cachedUrl = cacheMap.get(hash);
      if (cachedUrl) {
        for (const { index, text } of entries) {
          cached.push({ index, text, audioUrl: cachedUrl });
        }
      } else {
        if (!uncachedHashes.has(hash)) {
          uncachedHashes.add(hash);
          uncached.push({
            index: entries[0].index,
            text: entries[0].text,
            hash,
          });
        }
      }
    }

    this.logger.log(
      `Batch story ${storyId}: ${cached.length} cached (${batchProvider}), ${uncached.length} to generate`,
    );

    if (uncached.length === 0) {
      return {
        results: cached.sort((a, b) => a.index - b.index),
        totalParagraphs: allParagraphs.length,
        wasTruncated,
        usedProvider: batchProvider,
      };
    }

    // ── Provider failover chain for batch generation ──
    // All uncached paragraphs are sent to ONE provider. If that provider
    // fails, we retry the ENTIRE batch with the next provider in the chain
    // so users always get a complete story with consistent voice.
    const providerChain: Array<'elevenlabs' | 'deepgram' | 'edgetts'> = [];
    if (batchProvider === 'elevenlabs')
      providerChain.push('elevenlabs', 'deepgram', 'edgetts');
    else if (batchProvider === 'deepgram')
      providerChain.push('deepgram', 'edgetts');
    else providerChain.push('edgetts');

    const preferredProvider = batchProvider;

    type BatchResult = {
      index: number;
      text: string;
      audioUrl: string | null;
      hash: string;
      provider: string | null;
    };

    let generated: BatchResult[] = [];
    let actualProvider = batchProvider;

    for (const provider of providerChain) {
      // For non-first providers: check circuit breaker and re-do cache lookup
      if (provider !== batchProvider) {
        const breaker = this.getBreakerForProvider(provider);
        if (!breaker.canExecute()) {
          this.logger.warn(
            `${provider} circuit breaker OPEN, skipping failover for batch story ${storyId}`,
          );
          continue;
        }
        // Re-do cache lookup for this provider
        const providerCacheEntries =
          await this.prisma.paragraphAudioCache.findMany({
            where: {
              storyId,
              voiceId: type,
              provider,
              textHash: { in: [...hashMap.keys()] },
            },
          });
        const providerCacheMap = new Map(
          providerCacheEntries.map((e) => [e.textHash, e.audioUrl]),
        );

        // Rebuild cached/uncached arrays for this provider
        cached = [];
        uncached = [];
        uncachedHashes = new Set<string>();
        for (const [hash, entries] of hashMap) {
          const cachedUrl = providerCacheMap.get(hash);
          if (cachedUrl) {
            for (const { index, text } of entries) {
              cached.push({ index, text, audioUrl: cachedUrl });
            }
          } else {
            if (!uncachedHashes.has(hash)) {
              uncachedHashes.add(hash);
              uncached.push({
                index: entries[0].index,
                text: entries[0].text,
                hash,
              });
            }
          }
        }
        if (uncached.length === 0) {
          actualProvider = provider;
          break;
        }
      }

      const attempt = await this.generateBatchForProvider(
        uncached,
        provider,
        storyId,
        voiceType,
        userId,
        isPremium,
      );

      if (attempt.failedCount === 0) {
        generated = attempt.results;
        actualProvider = provider;
        break;
      }

      this.logger.warn(
        `Batch story ${storyId}: ${attempt.failedCount}/${uncached.length} failed with ${provider}, trying next provider`,
      );
      actualProvider = provider;
      generated = attempt.results;
    }

    const failedCount = generated.filter((r) => !r.audioUrl).length;
    if (failedCount > 0) {
      this.logger.warn(
        `Batch story ${storyId}: ${failedCount}/${uncached.length} paragraphs failed on all providers`,
      );
    }

    // Replicate generated audioUrls to duplicate paragraphs (same hash, different indices)
    const generatedUrlByHash = new Map<string, string | null>();
    for (const { hash, audioUrl } of generated) {
      generatedUrlByHash.set(hash, audioUrl);
    }

    const duplicates: Array<{
      index: number;
      text: string;
      audioUrl: string | null;
    }> = [];
    for (const [hash, entries] of hashMap) {
      const url = generatedUrlByHash.get(hash);
      if (url === undefined) continue; // hash was cached, not generated
      // Skip the first entry (already in `generated`), replicate to the rest
      for (let i = 1; i < entries.length; i++) {
        duplicates.push({
          index: entries[i].index,
          text: entries[i].text,
          audioUrl: url,
        });
      }
    }

    // Report degraded status when any TTS breaker is OPEN (read-only snapshot
    // to avoid side effects like advancing OPEN → HALF_OPEN)
    const isDegraded = [
      this.elevenLabsBreaker,
      this.deepgramBreaker,
      this.edgeTtsBreaker,
    ].some((b) => b.getSnapshot().state === CircuitState.OPEN);

    return {
      results: [...cached, ...generated, ...duplicates].sort(
        (a, b) => a.index - b.index,
      ),
      totalParagraphs: allParagraphs.length,
      wasTruncated,
      usedProvider: actualProvider,
      ...(actualProvider !== preferredProvider
        ? { preferredProvider }
        : {}),
      ...(isDegraded ? { providerStatus: 'degraded' as const } : {}),
    };
  }

  /** Generate a batch of paragraphs using a single provider */
  private async generateBatchForProvider(
    uncached: Array<{ index: number; text: string; hash: string }>,
    batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts',
    storyId: string,
    voiceType: VoiceType | string | undefined,
    userId: string | undefined,
    isPremium: boolean,
  ): Promise<{
    results: Array<{
      index: number;
      text: string;
      audioUrl: string | null;
      hash: string;
      provider: string | null;
    }>;
    failedCount: number;
  }> {
    const results: Array<{
      index: number;
      text: string;
      audioUrl: string | null;
      hash: string;
      provider: string | null;
    }> = [];

    this.logger.log(
      `Batch story ${storyId}: generating ${uncached.length} paragraphs with ${batchProvider}`,
    );

    for (let i = 0; i < uncached.length; i += MAX_CONCURRENT) {
      const chunk = uncached.slice(i, i + MAX_CONCURRENT);
      const chunkResults = await Promise.all(
        chunk.map(async ({ index, text, hash }) => {
          try {
            const result = await this.generateTTS(
              storyId,
              text,
              voiceType,
              userId,
              {
                skipQuotaCheck: true,
                isPremium,
                providerOverride: batchProvider,
              },
            );
            return {
              index,
              text,
              hash,
              audioUrl: result.audioUrl,
              provider: result.provider,
              ok: true as const,
            };
          } catch {
            return {
              index,
              text,
              hash,
              audioUrl: null,
              provider: null,
              ok: false as const,
            };
          }
        }),
      );

      for (const r of chunkResults) {
        results.push({
          index: r.index,
          text: r.text,
          hash: r.hash,
          audioUrl: r.audioUrl,
          provider: r.provider,
        });
      }
    }

    const failedCount = results.filter((r) => !r.audioUrl).length;
    return { results, failedCount };
  }
}
