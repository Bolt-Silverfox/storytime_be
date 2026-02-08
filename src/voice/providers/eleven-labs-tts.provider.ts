import {
  ITextToSpeechProvider,
  IVoiceCloningProvider,
} from '../interfaces/speech-provider.interface';
import { ElevenLabsClient } from 'elevenlabs';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamConverter } from '../utils/stream-converter';

/** Configuration for retry behavior */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

@Injectable()
export class ElevenLabsTTSProvider
  implements ITextToSpeechProvider, IVoiceCloningProvider
{
  private readonly logger = new Logger(ElevenLabsTTSProvider.name);
  private client: ElevenLabsClient;
  public readonly name = 'ElevenLabs';

  constructor(
    private readonly configService: ConfigService,
    private readonly converter: StreamConverter,
  ) {
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
      throw new ServiceUnavailableException(
        'ElevenLabs client is not initialized',
      );
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
    }, 'generateAudio');
  }

  /**
   * Retry wrapper with exponential backoff
   * Handles rate limits (429) and transient failures
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
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
      throw new ServiceUnavailableException(
        'ElevenLabs client is not initialized',
      );
    }

    try {
      this.logger.log(`Cloning voice "${name}"...`);
      const blob = new Blob([new Uint8Array(fileBuffer)], {
        type: 'audio/mpeg',
      });

      const response = await this.client.voices.add({
        name,

        files: [blob as unknown as File],
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

  async getSubscriptionInfo(): Promise<unknown> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'ElevenLabs client is not initialized',
      );
    }

    try {
      return await this.client.user.getSubscription();
    } catch (error) {
      this.logger.error(
        `Failed to fetch ElevenLabs subscription info: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
