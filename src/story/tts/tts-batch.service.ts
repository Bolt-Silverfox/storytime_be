import { Injectable, Logger } from '@nestjs/common';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../../voice/dto/voice.dto';
import { DEFAULT_VOICE } from '../../voice/voice.constants';
import {
  CircuitBreakerService,
  CircuitBreaker,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';
import { TTS_CIRCUIT_BREAKER_CONFIG } from '@/shared/constants/circuit-breaker.constants';
import { splitByWordCountPreservingSentences } from '../../voice/utils/paragraph-splitter';
import { VoiceQuotaService } from '../../voice/voice-quota.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import { TtsSynthesisService } from './tts-synthesis.service';
import { TtsCacheService } from './tts-cache.service';

/** Must match mobile StoryContentContainer's wordsPerChunk */
const WORDS_PER_CHUNK = 30;
/** Max concurrent TTS provider calls in a batch */
const MAX_CONCURRENT = 5;
/** Max paragraphs allowed in a single batch request */
const MAX_BATCH_PARAGRAPHS = 50;

/**
 * Batch orchestration: splits a story into paragraphs, chooses a single locked
 * provider for the whole batch, and drives concurrent per-paragraph synthesis
 * (delegated to {@link TtsSynthesisService}) with provider failover. Preserves
 * the exact concurrency limit, ordering, and provider-failover semantics.
 */
@Injectable()
export class TtsBatchService {
  private readonly logger = new Logger(TtsBatchService.name);
  private readonly elevenLabsBreaker: CircuitBreaker;
  private readonly deepgramBreaker: CircuitBreaker;
  private readonly edgeTtsBreaker: CircuitBreaker;

  constructor(
    private readonly synthesis: TtsSynthesisService,
    private readonly cache: TtsCacheService,
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
   * Eagerly generates the first few uncached paragraphs and returns
   * the remaining uncached paragraphs for background queue processing.
   */
  async batchTextToSpeechEager(
    storyId: string,
    fullText: string,
    voiceType?: VoiceType | string,
    userId?: string,
    eagerCount = 2,
  ): Promise<{
    results: Array<{ index: number; text: string; audioUrl: string | null }>;
    totalParagraphs: number;
    wasTruncated: boolean;
    usedProvider: 'elevenlabs' | 'deepgram' | 'edgetts' | 'none';
    preferredProvider?: 'elevenlabs' | 'deepgram' | 'edgetts';
    providerStatus?: 'degraded';
    /** Whether all eager paragraphs failed to generate */
    eagerFailed: boolean;
    /** Remaining uncached paragraphs for background generation */
    remainingUncached: Array<{
      index: number;
      text: string;
      hash: string;
      duplicateIndices?: number[];
    }>;
    /** The provider locked in for this batch */
    batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts';
    isPremium: boolean;
  }> {
    if (!fullText?.trim())
      return {
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
        usedProvider: 'none',
        eagerFailed: false,
        remainingUncached: [],
        batchProvider: 'edgetts',
        isPremium: false,
      };

    const resolvedType =
      VOICE_TYPE_MIGRATION_MAP[voiceType as string] ??
      voiceType ??
      DEFAULT_VOICE;

    const { allParagraphCount, wasTruncated, hashMap } =
      this.prepareBatchParagraphs(storyId, fullText);

    const { batchProvider, isPremium, preferredProvider } =
      await this.determineBatchProvider(storyId, voiceType, userId);

    const { cached, uncached } = await this.cache.rebuildCacheForProvider(
      batchProvider,
      hashMap,
      storyId,
      resolvedType,
    );

    this.logger.log(
      `Eager batch story ${storyId}: ${cached.length} cached (${batchProvider}), ${uncached.length} to generate`,
    );

    if (uncached.length === 0) {
      return {
        results: cached.sort((a, b) => a.index - b.index),
        totalParagraphs: allParagraphCount,
        wasTruncated,
        usedProvider: batchProvider,
        ...(batchProvider !== preferredProvider ? { preferredProvider } : {}),
        eagerFailed: false,
        remainingUncached: [],
        batchProvider,
        isPremium,
      };
    }

    // Eagerly generate only the first `eagerCount` uncached paragraphs
    const eagerParagraphs = uncached.slice(0, eagerCount);
    const remainingUncached = uncached.slice(eagerCount);

    const eagerResults = await this.generateBatchForProvider(
      eagerParagraphs,
      batchProvider,
      storyId,
      resolvedType,
      userId,
      isPremium,
    );

    const eagerFailed = eagerResults.failedCount === eagerParagraphs.length;
    if (eagerFailed) {
      this.logger.warn(
        `Eager batch story ${storyId}: all ${eagerParagraphs.length} eager paragraphs failed with ${batchProvider}`,
      );
    }

    // Replicate generated audioUrls to duplicate paragraphs (same hash)
    // Only store successful results — null audioUrls should not poison the filter
    const eagerUrlByHash = new Map<string, string>();
    for (const { hash, audioUrl } of eagerResults.results) {
      if (audioUrl) {
        eagerUrlByHash.set(hash, audioUrl);
      }
    }

    const duplicates: Array<{
      index: number;
      text: string;
      audioUrl: string;
    }> = [];
    for (const [hash, entries] of hashMap) {
      const url = eagerUrlByHash.get(hash);
      if (!url) continue;
      for (let i = 1; i < entries.length; i++) {
        duplicates.push({
          index: entries[i].index,
          text: entries[i].text,
          audioUrl: url,
        });
      }
    }

    // Re-add eager paragraphs that failed (audioUrl is null) back into the background queue
    const failedEager = eagerParagraphs.filter(
      (p) => !eagerUrlByHash.has(p.hash),
    );

    // Filter remaining uncached: remove any whose hash was successfully generated eagerly
    const filteredRemaining = [
      ...failedEager,
      ...remainingUncached.filter((p) => !eagerUrlByHash.has(p.hash)),
    ];

    const isDegraded = [
      this.elevenLabsBreaker,
      this.deepgramBreaker,
      this.edgeTtsBreaker,
    ].some((b) => b.getSnapshot().state === CircuitState.OPEN);

    return {
      results: [...cached, ...eagerResults.results, ...duplicates]
        .sort((a, b) => a.index - b.index)
        .map(({ index, text, audioUrl }) => ({ index, text, audioUrl })),
      totalParagraphs: allParagraphCount,
      wasTruncated,
      usedProvider: batchProvider,
      ...(batchProvider !== preferredProvider ? { preferredProvider } : {}),
      ...(isDegraded ? { providerStatus: 'degraded' as const } : {}),
      eagerFailed,
      remainingUncached: filteredRemaining,
      batchProvider,
      isPremium,
    };
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
    usedProvider: 'elevenlabs' | 'deepgram' | 'edgetts' | 'none';
    preferredProvider?: 'elevenlabs' | 'deepgram' | 'edgetts';
    providerStatus?: 'degraded';
  }> {
    if (!fullText?.trim())
      return {
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
        usedProvider: 'none',
      };

    const type =
      VOICE_TYPE_MIGRATION_MAP[voiceType as string] ??
      voiceType ??
      DEFAULT_VOICE;

    const { allParagraphCount, wasTruncated, hashMap } =
      this.prepareBatchParagraphs(storyId, fullText);

    const { batchProvider, isPremium, preferredProvider } =
      await this.determineBatchProvider(storyId, voiceType, userId);

    let { cached, uncached } = await this.cache.rebuildCacheForProvider(
      batchProvider,
      hashMap,
      storyId,
      type,
    );

    this.logger.log(
      `Batch story ${storyId}: ${cached.length} cached (${batchProvider}), ${uncached.length} to generate`,
    );

    if (uncached.length === 0) {
      return {
        results: cached.sort((a, b) => a.index - b.index),
        totalParagraphs: allParagraphCount,
        wasTruncated,
        usedProvider: batchProvider,
      };
    }

    // ── Provider failover chain for batch generation ──
    const providerChain: Array<'elevenlabs' | 'deepgram' | 'edgetts'> = [];
    if (batchProvider === 'elevenlabs')
      providerChain.push('elevenlabs', 'deepgram', 'edgetts');
    else if (batchProvider === 'deepgram')
      providerChain.push('deepgram', 'edgetts');
    else providerChain.push('edgetts');

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
        ({ cached, uncached } = await this.cache.rebuildCacheForProvider(
          provider,
          hashMap,
          storyId,
          type,
        ));
        if (uncached.length === 0) {
          generated = [];
          actualProvider = provider;
          break;
        }
      }

      const attempt = await this.generateBatchForProvider(
        uncached,
        provider,
        storyId,
        type,
        userId,
        isPremium,
      );

      if (attempt.failedCount === 0) {
        generated = attempt.results;
        actualProvider = provider;
        break;
      }

      // Intentional: discard partial results from this provider and retry ALL
      // uncached paragraphs on the next provider. The next iteration rebuilds
      // uncached from a fresh cache lookup scoped to the new provider, ensuring
      // all returned audio comes from a single provider for voice consistency.
      // Audio already uploaded by this provider remains cached for future use.
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
      results: [...cached, ...generated, ...duplicates]
        .sort((a, b) => a.index - b.index)
        .map(({ index, text, audioUrl }) => ({ index, text, audioUrl })),
      totalParagraphs: allParagraphCount,
      wasTruncated,
      usedProvider: actualProvider,
      ...(actualProvider !== preferredProvider ? { preferredProvider } : {}),
      ...(isDegraded ? { providerStatus: 'degraded' as const } : {}),
    };
  }

  /** Split text into paragraphs, build hash map, apply truncation */
  private prepareBatchParagraphs(
    storyId: string,
    fullText: string,
  ): {
    allParagraphCount: number;
    wasTruncated: boolean;
    hashMap: Map<string, Array<{ index: number; text: string }>>;
  } {
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

    const hashMap = new Map<string, Array<{ index: number; text: string }>>();
    for (let idx = 0; idx < paragraphs.length; idx++) {
      const hash = this.cache.hashText(paragraphs[idx]);
      const entries = hashMap.get(hash) ?? [];
      entries.push({ index: idx, text: paragraphs[idx] });
      hashMap.set(hash, entries);
    }

    return {
      allParagraphCount: allParagraphs.length,
      wasTruncated,
      hashMap,
    };
  }

  /** Determine which TTS provider to use for the entire batch */
  private async determineBatchProvider(
    storyId: string,
    voiceType: VoiceType | string | undefined,
    userId: string | undefined,
  ): Promise<{
    batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts';
    isPremium: boolean;
    preferredProvider: 'elevenlabs' | 'deepgram' | 'edgetts';
  }> {
    const type =
      VOICE_TYPE_MIGRATION_MAP[voiceType as string] ??
      voiceType ??
      DEFAULT_VOICE;

    const quotaVoiceId = await this.synthesis.resolveCanonicalVoiceId(type);
    let isPremium = false;
    let useElevenLabsBatch = false;

    if (userId && quotaVoiceId) {
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
    } else if (userId && !quotaVoiceId) {
      isPremium = await this.subscriptionService.isPremiumUser(userId);
      this.logger.warn(
        `Batch story ${storyId}: unrecognised voice ${type}, skipping ElevenLabs.`,
      );
    }

    let batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts' =
      useElevenLabsBatch ? 'elevenlabs' : 'deepgram';

    // Capture preferred provider before breaker downgrades
    const preferredProvider: 'elevenlabs' | 'deepgram' = useElevenLabsBatch
      ? 'elevenlabs'
      : 'deepgram';

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

    return { batchProvider, isPremium, preferredProvider };
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
            const result = await this.synthesis.generateTTS(
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
