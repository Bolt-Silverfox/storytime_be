import { UploadService } from '../upload/upload.service';
import { Injectable } from '@nestjs/common';
import { VoiceType } from '../voice/dto/voice.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';

import { VoiceQuotaService } from '../voice/voice-quota.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { TtsCacheService } from './tts/tts-cache.service';
import { TtsSynthesisService } from './tts/tts-synthesis.service';
import { TtsBatchService } from './tts/tts-batch.service';
import { PrismaStoryTtsRepository } from './repositories/prisma-story-tts.repository';

// Re-export so existing importers keep resolving `preprocessTextForTTS`
// from this module unchanged.
export { preprocessTextForTTS } from './tts/tts-text.util';

/**
 * Thin facade over the focused TTS services. Delegates single-unit synthesis
 * to {@link TtsSynthesisService} and batch orchestration to
 * {@link TtsBatchService}, keeping every public method + signature so all
 * existing injectors keep working unchanged.
 *
 * The collaborators are constructed here from the same injected dependencies
 * rather than DI-registered, because `TextToSpeechService` is provided in
 * `VoiceModule` whose private providers (Deepgram/Edge/StreamConverter/…) are
 * not exported — so the collaborators cannot resolve in `StoryModule`, and
 * `VoiceModule` is out of refactor scope. Wiring them here preserves the exact
 * DI surface (this constructor's parameters are unchanged) while the circuit
 * breakers stay shared via the name-keyed `CircuitBreakerService` registry.
 */
@Injectable()
export class TextToSpeechService {
  private readonly synthesis: TtsSynthesisService;
  private readonly batch: TtsBatchService;

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
    // The TTS collaborators route DB access through a repository. Like the
    // services themselves (see class doc), the repository is hand-constructed
    // here from the injected PrismaService rather than DI-registered.
    const ttsRepository = new PrismaStoryTtsRepository(this.prisma);
    const cache = new TtsCacheService(ttsRepository);
    this.synthesis = new TtsSynthesisService(
      this.uploadService,
      this.elevenLabsProvider,
      this.deepgramProvider,
      this.edgeTtsProvider,
      ttsRepository,
      this.voiceQuota,
      this.subscriptionService,
      this.cbService,
      cache,
    );
    this.batch = new TtsBatchService(
      this.synthesis,
      cache,
      this.voiceQuota,
      this.subscriptionService,
      this.cbService,
    );
  }

  async textToSpeechCloudUrl(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string,
    userId?: string,
    options?: { skipQuotaCheck?: boolean; isPremium?: boolean },
  ): Promise<string> {
    const result = await this.synthesis.generateTTS(
      storyId,
      text,
      voicetype,
      userId,
      options,
    );
    return result.audioUrl;
  }

  /**
   * Synthesize a full story's text into a single hosted audio file and return
   * its cloud URL. Domain-named wrapper around {@link textToSpeechCloudUrl}
   * used by the voice queue processor and story generation pipeline.
   */
  async synthesizeStory(
    storyId: string,
    text: string,
    voicetype?: VoiceType | string,
    userId?: string,
    options?: { skipQuotaCheck?: boolean; isPremium?: boolean },
  ): Promise<string> {
    return this.textToSpeechCloudUrl(storyId, text, voicetype, userId, options);
  }

  /**
   * Public wrapper around generateTTS for use by the batch queue processor.
   * Generates TTS for a single paragraph with a locked provider (no fallback).
   */
  async generateSingleParagraphTTS(
    storyId: string,
    text: string,
    voiceType: string,
    userId: string,
    options: {
      isPremium: boolean;
      providerOverride: 'elevenlabs' | 'deepgram' | 'edgetts';
    },
  ): Promise<{ audioUrl: string; provider: string }> {
    const result = await this.synthesis.generateTTS(
      storyId,
      text,
      voiceType,
      userId,
      {
        skipQuotaCheck: true,
        isPremium: options.isPremium,
        providerOverride: options.providerOverride,
      },
    );
    return { audioUrl: result.audioUrl, provider: result.provider };
  }

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
    eagerFailed: boolean;
    remainingUncached: Array<{
      index: number;
      text: string;
      hash: string;
      duplicateIndices?: number[];
    }>;
    batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts';
    isPremium: boolean;
  }> {
    return this.batch.batchTextToSpeechEager(
      storyId,
      fullText,
      voiceType,
      userId,
      eagerCount,
    );
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
    return this.batch.batchTextToSpeechCloudUrls(
      storyId,
      fullText,
      voiceType,
      userId,
    );
  }
}
