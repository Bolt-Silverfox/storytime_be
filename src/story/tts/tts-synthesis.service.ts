import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UploadService } from '../../upload/upload.service';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../../voice/dto/voice.dto';
import {
  VOICE_CONFIG,
  DEFAULT_VOICE,
  VoiceSettings,
} from '../../voice/voice.constants';
import { ElevenLabsTTSProvider } from '../../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../../voice/providers/deepgram-tts.provider';
import { EdgeTTSProvider } from '../../voice/providers/edge-tts.provider';
import type { IStoryTtsRepository } from '../repositories/story-tts.repository.interface';
import { VoiceQuotaService } from '../../voice/voice-quota.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import {
  CircuitBreakerService,
  CircuitBreaker,
} from '@/shared/services/circuit-breaker.service';
import { TTS_CIRCUIT_BREAKER_CONFIG } from '@/shared/constants/circuit-breaker.constants';
import {
  VOICE_CONFIG_SETTINGS,
  MAX_TTS_TEXT_LENGTH,
} from '../../voice/voice.config';
import { preprocessTextForTTS } from './tts-text.util';
import { TtsCacheService } from './tts-cache.service';

/** Internal result from TTS generation including which provider was used */
export interface TTSResult {
  audioUrl: string;
  provider: 'elevenlabs' | 'deepgram' | 'edgetts' | 'cache';
}

/**
 * Provider-fallback / single-unit synthesis core: try ElevenLabs → Deepgram →
 * EdgeTTS guarded by circuit breakers, with voice-id resolution and text
 * normalization. Owns the per-provider circuit breakers (shared by name via
 * {@link CircuitBreakerService}).
 */
@Injectable()
export class TtsSynthesisService {
  private readonly logger = new Logger(TtsSynthesisService.name);
  private readonly elevenLabsBreaker: CircuitBreaker;
  private readonly deepgramBreaker: CircuitBreaker;
  private readonly edgeTtsBreaker: CircuitBreaker;

  constructor(
    private readonly uploadService: UploadService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly deepgramProvider: DeepgramTTSProvider,
    private readonly edgeTtsProvider: EdgeTTSProvider,
    private readonly ttsRepository: IStoryTtsRepository,
    private readonly voiceQuota: VoiceQuotaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly cbService: CircuitBreakerService,
    private readonly cache: TtsCacheService,
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
  getBreakerForProvider(
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
   * Returns undefined for unrecognised voices so callers skip ElevenLabs.
   */
  async resolveCanonicalVoiceId(type: string): Promise<string | undefined> {
    const canonical = await this.voiceQuota.resolveCanonicalVoiceId(type);
    // If voiceQuota returned the input unchanged and it's not an ElevenLabs ID
    // we recognise, the voice is unknown — return undefined to skip ElevenLabs.
    if (canonical === type && !this.isKnownElevenLabsId(canonical)) {
      return undefined;
    }
    return canonical;
  }

  /** Check if a string matches any known ElevenLabs voice ID */
  private isKnownElevenLabsId(id: string): boolean {
    return Object.values(VOICE_CONFIG).some((c) => c.elevenLabsId === id);
  }

  /**
   * Internal TTS generation that tracks which provider was used.
   * When `providerOverride` is set, only that provider is attempted
   * (no fallback chain). Used by batch mode to ensure voice consistency.
   */
  async generateTTS(
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

    // Check paragraph-level cache first.
    // When providerOverride is set (batch mode), scope cache to that provider
    // to avoid cross-provider cache hits that break voice consistency.
    const cachedUrl = await this.cache.getCachedParagraphAudio(
      storyId,
      text,
      type,
      options?.providerOverride,
    );
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
      const voice = await this.ttsRepository.findVoiceByIdOrName(type);
      if (voice && voice.elevenLabsVoiceId) {
        elevenLabsId = voice.elevenLabsVoiceId;
        voiceSettings = undefined;
        // Custom voices are ElevenLabs clones; use default voice for free-tier fallback
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        edgeTtsVoice = defaultConfig.edgeTtsVoice;
        deepgramVoice = defaultConfig.deepgramVoice;
      } else {
        // Unrecognized ID — skip ElevenLabs, use default Deepgram/Edge voices
        const defaultConfig = VOICE_CONFIG[DEFAULT_VOICE];
        elevenLabsId = undefined;
        edgeTtsVoice = defaultConfig.edgeTtsVoice;
        deepgramVoice = defaultConfig.deepgramVoice;
        voiceSettings = undefined;
        this.logger.warn(
          `Voice ID ${type} not found. Skipping ElevenLabs, using Deepgram/Edge fallback.`,
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
        await this.cache.cacheParagraphAudio(
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
}
