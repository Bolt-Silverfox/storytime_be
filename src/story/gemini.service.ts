import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { VoiceType } from '../voice/dto/voice.dto';
import { VoiceQuotaService } from '../voice/voice-quota.service';

/** Circuit breaker states */
enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing fast, not calling API
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/** Circuit breaker configuration */
const CIRCUIT_CONFIG = {
  failureThreshold: 5, // Open circuit after 5 consecutive failures
  resetTimeoutMs: 60000, // Try again after 1 minute
  halfOpenMaxAttempts: 1, // Allow 1 test request in half-open state
};

/** Retry configuration for transient failures */
const RETRY_CONFIG = {
  maxAttempts: 3, // Maximum retry attempts
  baseDelayMs: 1000, // Base delay (1 second)
  maxDelayMs: 8000, // Maximum delay cap
};

export interface GenerateStoryOptions {
  theme: string[];
  category: string[];
  seasons?: string[];
  ageMin: number;
  ageMax: number;
  language?: string;
  kidName?: string;
  additionalContext?: string;
  creatorKidId?: string;
  voiceType?: VoiceType;
  seasonIds?: string[];
  userId?: string;
}

export interface GeneratedStory {
  title: string;
  description: string;
  content: string;
  questions: Array<{
    question: string;
    options: string[];
    answer: number;
  }>;
  theme: string[];
  category: string[];
  seasons?: string[];
  ageMin: number;
  ageMax: number;
  language: string;
  difficultyLevel: number;
  estimatedWordCount: number;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenerativeAI;

  // Circuit breaker state
  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  constructor(
    private configService: ConfigService,
    private readonly voiceQuotaService: VoiceQuotaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not configured. Story generation will not be available.',
      );
      return;
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Check if circuit allows requests
   * Returns true if request should proceed, false if should fail fast
   */
  private canMakeRequest(): boolean {
    const now = Date.now();

    switch (this.circuitState) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if enough time has passed to try again
        if (now - this.lastFailureTime >= CIRCUIT_CONFIG.resetTimeoutMs) {
          this.circuitState = CircuitState.HALF_OPEN;
          this.halfOpenAttempts = 0;
          this.logger.log('Circuit breaker transitioning to HALF_OPEN state');
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited test requests
        if (this.halfOpenAttempts < CIRCUIT_CONFIG.halfOpenMaxAttempts) {
          this.halfOpenAttempts++;
          return true;
        }
        return false;

      default:
        return true;
    }
  }

  /**
   * Record a successful request - reset circuit breaker
   */
  private recordSuccess(): void {
    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.logger.log('Circuit breaker closing after successful request');
    }
    this.failureCount = 0;
    this.circuitState = CircuitState.CLOSED;
  }

  /**
   * Record a failed request - potentially open circuit
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === CircuitState.HALF_OPEN) {
      // Failed during test, go back to open
      this.circuitState = CircuitState.OPEN;
      this.logger.warn('Circuit breaker re-opening after failed test request');
    } else if (this.failureCount >= CIRCUIT_CONFIG.failureThreshold) {
      this.circuitState = CircuitState.OPEN;
      this.logger.warn(
        `Circuit breaker OPEN after ${this.failureCount} consecutive failures. ` +
          `Will retry in ${CIRCUIT_CONFIG.resetTimeoutMs / 1000}s`,
      );
    }
  }

  /**
   * Check if an error is transient and should trigger retry
   */
  private isTransientError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;

    const err = error as { status?: number; message?: string };
    return Boolean(
      err.status === 429 ||
        err.status === 503 ||
        err.status === 500 ||
        err.message?.includes('fetch failed') ||
        err.message?.includes('ETIMEDOUT') ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('network'),
    );
  }

  /**
   * Sleep helper for exponential backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private getBackoffDelay(attempt: number): number {
    const exponentialDelay =
      RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelayMs);
    // Add 0-25% jitter to prevent thundering herd
    const jitter = cappedDelay * Math.random() * 0.25;
    return Math.floor(cappedDelay + jitter);
  }

  async generateStory(options: GenerateStoryOptions): Promise<GeneratedStory> {
    if (!this.genAI) {
      throw new ServiceUnavailableException(
        'Gemini API is not configured. Please set GEMINI_API_KEY environment variable.',
      );
    }

    // Circuit breaker check - fail fast if circuit is open
    if (!this.canMakeRequest()) {
      this.logger.warn('Circuit breaker is OPEN - failing fast');
      throw new ServiceUnavailableException(
        'The AI storyteller is temporarily unavailable. Please try again in a minute.',
      );
    }

    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = this.buildPrompt(options);

    let lastError: unknown = null;

    // Retry loop with exponential backoff for transient errors
    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Parse the JSON response
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
        const story = JSON.parse(cleanText);

        // Validate the response structure
        if (!this.validateStoryStructure(story)) {
          throw new InternalServerErrorException(
            'Invalid story structure received from Gemini',
          );
        }

        // Track usage if userId is provided
        if (options.userId) {
          // Run in background to not block response
          this.voiceQuotaService
            .trackGeminiStory(options.userId)
            .catch((err) =>
              this.logger.error(
                `Failed to track Gemini story usage for user ${options.userId}:`,
                err,
              ),
            );
        }

        // Record success for circuit breaker
        this.recordSuccess();

        return {
          ...story,
          theme: options.theme,
          category: options.category,
          seasons: options.seasons,
          ageMin: options.ageMin,
          ageMax: options.ageMax,
          language: options.language || 'English',
        };
      } catch (error) {
        lastError = error;

        // Don't retry parse errors or validation errors - they won't succeed
        if (
          error instanceof SyntaxError ||
          error instanceof InternalServerErrorException
        ) {
          this.logger.error('Non-retryable error generating story:', error);
          throw new InternalServerErrorException(
            'Something went wrong generating the story. Please try again.',
          );
        }

        // Check if error is transient and worth retrying
        if (this.isTransientError(error)) {
          if (attempt < RETRY_CONFIG.maxAttempts) {
            const delay = this.getBackoffDelay(attempt);
            this.logger.warn(
              `Gemini API transient error (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}). ` +
                `Retrying in ${delay}ms...`,
            );
            await this.sleep(delay);
            continue;
          }

          // All retries exhausted - record failure for circuit breaker
          this.logger.error(
            `Gemini API failed after ${RETRY_CONFIG.maxAttempts} attempts`,
            error,
          );
          this.recordFailure();
        } else {
          // Non-transient error, don't retry
          this.logger.error('Non-transient Gemini API error:', error);
          break;
        }
      }
    }

    // Handle the final error after all retries exhausted
    const err = lastError as { status?: number; message?: string };

    // Network/Fetch errors
    if (
      err?.message &&
      (err.message.includes('fetch failed') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ECONNRESET'))
    ) {
      throw new ServiceUnavailableException(
        'We are having trouble connecting to the AI service right now. Please check your internet connection or try again in a moment.',
      );
    }

    // API Overload/Rate Limits
    if (err?.status === 429 || err?.status === 503) {
      throw new ServiceUnavailableException(
        'The AI storyteller is a bit busy right now. Please try again in 1 minute.',
      );
    }

    // Fallback for other errors
    throw new InternalServerErrorException(
      'Something went wrong generating the story. Please try again.',
    );
  }

  private buildPrompt(options: GenerateStoryOptions): string {
    const kidNamePart = options.kidName
      ? `The main character should be named ${options.kidName}.`
      : '';
    const contextPart = options.additionalContext
      ? `Additional context: ${options.additionalContext}`
      : '';

    return `Generate a children's story with the following requirements:

Theme(s): ${options.theme.join(', ')}
Category(s): ${options.category.join(', ')}
${options.seasons && options.seasons.length > 0 ? `Season(s): ${options.seasons.join(', ')}` : ''}
Age range: ${options.ageMin} to ${options.ageMax} years old
Language: ${options.language || 'English'}
${kidNamePart}
${contextPart}

The story requirements should be:
- Age-appropriate with vocabulary and concepts suitable for ${options.ageMin}-${options.ageMax} year olds
- Engaging and educational
- Between 300-500 words
- Have a clear beginning, middle, and end
- Include a positive message or lesson
- Use vivid descriptions and imagery
- Calculate a difficulty level (1-10) based on vocabulary complexity
- ESTIMATE the word count of the story

Return ONLY valid JSON (no markdown):
    {
      "title": "Story Title",
      "description": "Brief description",
      "difficultyLevel": 1, 
      "estimatedWordCount": 300,
      "content": "Opening paragraph...",
      "questions": [
        {
          "question": "A comprehension question about the story",
          "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
          "answer": 0
        }
      ]
    }

Include exactly 5 comprehension questions that test understanding of the story. The answer field should be the index (0-3) of the correct option.

Important: Return ONLY the JSON object, no additional text or markdown formatting.`;
  }

  private validateStoryStructure(story: unknown): story is GeneratedStory {
    if (!story || typeof story !== 'object') return false;

    const storyObj = story as Record<string, unknown>;
    const requiredFields = ['title', 'description', 'content', 'questions'];
    for (const field of requiredFields) {
      if (!storyObj[field]) return false;
    }

    const questions = storyObj.questions;
    if (!Array.isArray(questions) || questions.length < 1) return false;

    for (const question of questions) {
      const q = question as Record<string, unknown>;
      if (
        !q.question ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        typeof q.answer !== 'number' ||
        q.answer < 0 ||
        q.answer > 3
      ) {
        return false;
      }
    }

    return true;
  }

  generateStoryImage(
    title: string,
    description: string,
    userId?: string,
  ): string {
    const imagePrompt = `Children's story book cover for "${title}". ${description}. Colorful, vibrant, detailed, 4k, digital art style, friendly characters, magical atmosphere`;
    const encodedPrompt = encodeURIComponent(imagePrompt);
    const seed = Math.floor(Math.random() * 100000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;

    this.logger.log(`Generated Pollinations Image URL: ${imageUrl}`);

    // Track usage if userId is provided
    if (userId) {
      this.voiceQuotaService
        .trackGeminiImage(userId)
        .catch((err) =>
          this.logger.error(
            `Failed to track Gemini image usage for user ${userId}:`,
            err,
          ),
        );
    }

    return imageUrl;
  }
}
