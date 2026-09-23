import {
  ITextToSpeechProvider,
  IVoiceCloningProvider,
} from '../interfaces/speech-provider.interface';
import { ElevenLabsClient } from 'elevenlabs';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamConverter } from '../utils/stream-converter';
import { QuotaExhaustedError } from '../errors/quota-exhausted.error';

/** Configuration for retry behavior */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * How long to stop attempting synthesis after the account reports exhausted
 * credits (HTTP 402). Without this every paragraph in every batch pays a full
 * failed round-trip to ElevenLabs before cascading to the fallback provider,
 * which is pure added latency once the balance is gone. Overridable via
 * ELEVEN_LABS_QUOTA_COOLDOWN_MS.
 */
const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;

@Injectable()
export class ElevenLabsTTSProvider
  implements ITextToSpeechProvider, IVoiceCloningProvider
{
  private readonly logger = new Logger(ElevenLabsTTSProvider.name);
  private client: ElevenLabsClient;
  public readonly name = 'ElevenLabs';

  /**
   * Epoch ms until which this provider short-circuits synthesis because the
   * account reported exhausted credits. 0 means the breaker is closed.
   */
  private quotaExhaustedUntil = 0;
  /**
   * Bumped every time the breaker trips. A request captures this when it
   * starts and may only close the breaker if the value is unchanged, so a
   * slow success cannot clear a cooldown opened after it began. Synthesis is
   * batched per paragraph, so overlapping calls are the normal case here, not
   * an edge case.
   */
  private quotaBreakerGeneration = 0;
  private readonly quotaCooldownMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly converter: StreamConverter,
  ) {
    this.quotaCooldownMs =
      this.configService.get<number>('ELEVEN_LABS_QUOTA_COOLDOWN_MS') ??
      DEFAULT_QUOTA_COOLDOWN_MS;

    const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
    if (apiKey) {
      try {
        this.client = new ElevenLabsClient({ apiKey });
      } catch (err) {
        this.logger.error(
          `Failed to initialize ElevenLabs client: ${(err as Error).message}`,
        );
      }
    } else {
      this.logger.warn('ELEVEN_LABS_KEY is not set');
    }
  }

  async generateAudio(
    text: string,
    voiceId: string,
    modelId: string = 'eleven_multilingual_v2',

    options?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      use_speaker_boost?: boolean;
    },
  ): Promise<Buffer> {
    if (!this.client) {
      throw new Error('ElevenLabs client is not initialized');
    }

    // Credits were exhausted recently — fail immediately so the caller cascades
    // to the next provider without waiting on a request we know will 402.
    const breakerGeneration = this.quotaBreakerGeneration;
    if (this.isQuotaCooldownActive()) {
      throw new QuotaExhaustedError('ElevenLabs');
    }

    return this.withRetry(async () => {
      this.logger.log(
        `Generating audio with voice ${voiceId} and model ${modelId}`,
      );

      const convertOptions: Parameters<
        typeof this.client.textToSpeech.convert
      >[1] = {
        text,
        model_id: modelId,
        output_format: 'mp3_44100_128',
        ...(options && { voice_settings: options }),
      };

      const audioStream = await this.client.textToSpeech.convert(
        voiceId,
        convertOptions,
      );

      return await this.converter.toBuffer(audioStream);
    }, 'generateAudio', breakerGeneration);
  }

  /**
   * Retry wrapper with exponential backoff
   * Handles rate limits (429) and transient failures
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    breakerGeneration: number,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const result = await operation();
        // A success means credits are available again — but only if no 402 has
        // tripped the breaker since this request started. Without the
        // generation check, a call that began before a 402 and finished after
        // it would reopen a provider that is known to be out of credit.
        if (breakerGeneration === this.quotaBreakerGeneration) {
          this.quotaExhaustedUntil = 0;
        }
        return result;
      } catch (error) {
        lastError = error as Error;

        // 402 = quota/credits exhausted — fail immediately, no retry
        if (this.isQuotaExhaustedError(error)) {
          this.openQuotaBreaker(operationName);
          throw new QuotaExhaustedError('ElevenLabs');
        }

        const isRateLimit = this.isRateLimitError(error);
        const isRetryable = isRateLimit || this.isTransientError(error);

        if (!isRetryable || attempt === RETRY_CONFIG.maxRetries) {
          this.logger.error(
            `ElevenLabs ${operationName} failed after ${attempt} attempts: ${lastError.message}`,
          );
          throw lastError;
        }

        const delay = this.calculateBackoff(attempt, isRateLimit);
        this.logger.warn(
          `ElevenLabs ${operationName} attempt ${attempt} failed (${isRateLimit ? 'rate limited' : 'transient error'}), retrying in ${delay}ms`,
        );

        await this.sleep(delay);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** True while synthesis should be skipped after a recent 402. */
  private isQuotaCooldownActive(): boolean {
    return Date.now() < this.quotaExhaustedUntil;
  }

  /**
   * Trip the breaker. Logs only on the transition so a large batch doesn't
   * emit one warning per paragraph.
   */
  private openQuotaBreaker(operationName: string): void {
    const wasOpen = this.isQuotaCooldownActive();
    this.quotaBreakerGeneration++;
    this.quotaExhaustedUntil = Date.now() + this.quotaCooldownMs;
    if (!wasOpen) {
      this.logger.warn(
        `ElevenLabs ${operationName}: quota exhausted (402). Skipping ElevenLabs for ${Math.round(
          this.quotaCooldownMs / 1000,
        )}s and cascading to the fallback provider.`,
      );
    }
  }

  private isQuotaExhaustedError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      return err.status === 402 || err.statusCode === 402;
    }
    return false;
  }

  private isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      return err.status === 429 || err.statusCode === 429;
    }
    return false;
  }

  private isTransientError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      const status = (err.status || err.statusCode) as number | undefined;
      // Retry on 5xx errors and network timeouts
      return (status && status >= 500) || err.code === 'ETIMEDOUT';
    }
    return false;
  }

  private calculateBackoff(attempt: number, isRateLimit: boolean): number {
    // Use longer delays for rate limits
    const multiplier = isRateLimit ? 2 : 1;
    const delay = Math.min(
      RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1) * multiplier,
      RETRY_CONFIG.maxDelayMs,
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 500;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async addVoice(name: string, fileBuffer: Buffer): Promise<string> {
    if (!this.client) {
      throw new Error('ElevenLabs client is not initialized');
    }

    try {
      this.logger.log(`Cloning voice "${name}"...`);
      const blob = new Blob([new Uint8Array(fileBuffer)], {
        type: 'audio/mpeg',
      });

      const response = await this.client.voices.add({
        name,

        files: [blob as any],
        description: 'Cloned via StoryTime App',
      });

      return response.voice_id;
    } catch (error) {
      this.logger.error(
        `ElevenLabs voice cloning failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async getSubscriptionInfo(): Promise<any> {
    if (!this.client) {
      throw new Error('ElevenLabs client is not initialized');
    }

    try {
      return await this.client.user.getSubscription();
    } catch (error) {
      this.logger.error(
        `Failed to fetch ElevenLabs subscription info: ${(error as Error).message}`,
      );

      // Prevent ElevenLabs 401/403 from propagating as-is, which would
      // cause the frontend auth interceptor to trigger "session expired".
      if (error && typeof error === 'object') {
        const err = error as Record<string, unknown>;
        const status = (err.status || err.statusCode) as number | undefined;
        if (status === 401 || status === 403) {
          throw new BadGatewayException('ElevenLabs API authentication error');
        }
      }

      throw error;
    }
  }
}
