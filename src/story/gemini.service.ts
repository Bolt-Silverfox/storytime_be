import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { GoogleGenAI } from '@google/genai';
import { EnvConfig } from '@/shared/config/env.validation';
import { firstValueFrom } from 'rxjs';
import { VoiceType } from '../voice/dto/voice.dto';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { UploadService } from '../upload/upload.service';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { withResilience, CircuitOpenError } from '@/shared/resilience';

/** Hugging Face Inference API endpoint for cover image generation */
const HF_IMAGE_API_URL =
  'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

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
  private readonly genAI: GoogleGenAI;
  private readonly hfToken: string;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly httpService: HttpService,
    private readonly voiceQuotaService: VoiceQuotaService,
    private readonly uploadService: UploadService,
    private readonly cbService: CircuitBreakerService,
  ) {
    this.genAI = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
    this.hfToken = this.configService.get<string>('HF_TOKEN');
  }

  async generateStory(options: GenerateStoryOptions): Promise<GeneratedStory> {
    const breaker = this.cbService.getBreaker('gemini', {
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
      halfOpenMaxAttempts: 1,
    });

    // Circuit breaker check - fail fast if circuit is open
    if (!breaker.canExecute()) {
      this.logger.warn('Circuit breaker is OPEN - failing fast');
      throw new ServiceUnavailableException(
        'The AI storyteller is temporarily unavailable. Please try again in a minute.',
      );
    }

    const prompt = this.buildPrompt(options);

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const text = result.text;
      if (!text) {
        throw new Error('Gemini returned an empty response');
      }

      // Parse the JSON response
      const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
      const story = JSON.parse(cleanText);

      // Validate the response structure
      if (!this.validateStoryStructure(story)) {
        throw new Error('Invalid story structure received from Gemini');
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
      breaker.recordSuccess();

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
      this.logger.error('Failed to generate story with Gemini:', error);

      // Record the failure on the shared breaker. The breaker filters
      // non-transient errors (parse/validation/4xx) internally via
      // isTransientError, so only genuine API instability trips it.
      breaker.recordFailure(error);

      // The following status/message-based classification chooses WHICH
      // user-facing exception to throw and is independent of the breaker.
      const errorObj =
        error != null && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : {};
      const httpStatus = Number(errorObj.status ?? errorObj.code);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // 1. Check for Network/Fetch errors
      if (
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ETIMEDOUT')
      ) {
        throw new ServiceUnavailableException(
          'We are having trouble connecting to the AI service right now. Please check your internet connection or try again in a moment.',
        );
      }

      // 2. Check for API Overload/Rate Limits
      if (httpStatus === 429 || httpStatus === 503) {
        throw new ServiceUnavailableException(
          'The AI storyteller is a bit busy right now. Please try again in 1 minute.',
        );
      }

      // 3. Fallback for other errors (parse errors, validation, etc.)
      throw new InternalServerErrorException(
        'Something went wrong generating the story. Please try again.',
      );
    }
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

  async generateStoryImage(
    title: string,
    description: string,
    userId?: string,
  ): Promise<string> {
    const imagePrompt = `Children's story book cover for "${title}". ${description}. Colorful, vibrant, detailed, 4k, digital art style, friendly characters, magical atmosphere`;

    this.logger.log(
      `Generating cover image for "${title}" via Hugging Face FLUX`,
    );

    try {
      const response = await withResilience(
        this.cbService.getBreaker('hf-image'),
        () =>
          firstValueFrom(
            this.httpService.post(
              HF_IMAGE_API_URL,
              { inputs: imagePrompt },
              {
                headers: {
                  Authorization: `Bearer ${this.hfToken}`,
                  Accept: 'image/png',
                },
                responseType: 'arraybuffer',
                timeout: 60000,
              },
            ),
          ),
        { retries: 2 },
      );

      const buffer = Buffer.from(response.data as ArrayBuffer);
      if (buffer.length < 1024) {
        throw new Error(
          `Hugging Face returned invalid image data (${buffer.length} bytes)`,
        );
      }

      const result = await this.uploadService.uploadImageFromBuffer(
        buffer,
        'covers',
      );
      this.logger.log(
        `Cover image uploaded to Cloudinary: ${result.secure_url}`,
      );

      if (userId) {
        this.voiceQuotaService
          .trackGeminiImage(userId)
          .catch((err) =>
            this.logger.error(
              `Failed to track image usage for user ${userId}:`,
              err,
            ),
          );
      }

      return result.secure_url;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cover image generation failed for "${title}": ${msg}`);

      // Breaker OPEN: fast-fail with a "temporarily unavailable" message.
      if (error instanceof CircuitOpenError) {
        throw new ServiceUnavailableException(
          'Cover image generation is temporarily unavailable. Please try again in a minute.',
        );
      }

      throw new InternalServerErrorException(
        'Failed to generate cover image. Please try again.',
      );
    }
  }
}
