import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { Category, Theme } from '@prisma/client';
import { EnvConfig } from '@/shared/config/env.validation';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { withResilience, CircuitOpenError } from '@/shared/resilience';
import { UploadService } from '../upload/upload.service';
import { ADMIN_STORY_REPOSITORY, IAdminStoryRepository } from './repositories';

/**
 * Hugging Face Inference API endpoint for cover image generation.
 *
 * Mirrors `HF_IMAGE_API_URL` in `story/gemini.service.ts` (same FLUX.1-schnell
 * model). Kept as its own constant rather than importing from GeminiService
 * so this admin-only concern (category/theme cover art) doesn't pull in or
 * couple to that service's unrelated story-generation internals.
 */
const HF_IMAGE_API_URL =
  'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

type ContentKind = 'category' | 'theme';

/**
 * Generates and persists cover images for categories and themes — the admin
 * equivalent of GeminiService.generateStoryImage, for content taxonomy
 * entries rather than stories.
 */
@Injectable()
export class AdminContentImageService {
  private readonly logger = new Logger(AdminContentImageService.name);
  private readonly hfToken: string;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly httpService: HttpService,
    private readonly uploadService: UploadService,
    private readonly cbService: CircuitBreakerService,
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly storyRepo: IAdminStoryRepository,
  ) {
    this.hfToken = this.configService.get<string>('HF_TOKEN');
  }

  async generateCategoryImage(categoryId: string): Promise<Category> {
    const category = await this.storyRepo.findCategoryById(categoryId);
    if (!category) {
      throw new NotFoundException(`Category ${categoryId} not found`);
    }

    const imageUrl = await this.generateImage(
      'category',
      category.name,
      category.description,
    );
    return this.storyRepo.updateCategoryImage(categoryId, imageUrl);
  }

  async generateThemeImage(themeId: string): Promise<Theme> {
    const theme = await this.storyRepo.findThemeById(themeId);
    if (!theme) {
      throw new NotFoundException(`Theme ${themeId} not found`);
    }

    const imageUrl = await this.generateImage(
      'theme',
      theme.name,
      theme.description,
    );
    return this.storyRepo.updateThemeImage(themeId, imageUrl);
  }

  /** Direct admin upload (no AI) — sets the category image from a file. */
  async uploadCategoryImage(
    categoryId: string,
    file: Express.Multer.File,
  ): Promise<Category> {
    const category = await this.storyRepo.findCategoryById(categoryId);
    if (!category) {
      throw new NotFoundException(`Category ${categoryId} not found`);
    }
    const result = await this.uploadService.uploadImage(file, 'categories');
    return this.storyRepo.updateCategoryImage(categoryId, result.secure_url);
  }

  /** Direct admin upload (no AI) — sets the theme image from a file. */
  async uploadThemeImage(
    themeId: string,
    file: Express.Multer.File,
  ): Promise<Theme> {
    const theme = await this.storyRepo.findThemeById(themeId);
    if (!theme) {
      throw new NotFoundException(`Theme ${themeId} not found`);
    }
    const result = await this.uploadService.uploadImage(file, 'themes');
    return this.storyRepo.updateThemeImage(themeId, result.secure_url);
  }

  private buildPrompt(
    kind: ContentKind,
    name: string,
    description: string | null,
  ): string {
    return (
      `Children's book ${kind} illustration for "${name}". ${description ?? ''}. ` +
      'Colorful, vibrant, flat illustration style, friendly, whimsical, ' +
      'suitable for a kids reading app, no text, no words'
    );
  }

  private async generateImage(
    kind: ContentKind,
    name: string,
    description: string | null,
  ): Promise<string> {
    const prompt = this.buildPrompt(kind, name, description);
    const folder = kind === 'category' ? 'categories' : 'themes';

    this.logger.log(
      `Generating ${kind} cover image for "${name}" via Hugging Face FLUX`,
    );

    try {
      const response = await withResilience(
        this.cbService.getBreaker('hf-image'),
        () =>
          firstValueFrom(
            this.httpService.post(
              HF_IMAGE_API_URL,
              { inputs: prompt },
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
        folder,
      );
      this.logger.log(
        `${kind} cover image uploaded to Cloudinary: ${result.secure_url}`,
      );
      return result.secure_url;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${kind} cover image generation failed for "${name}": ${msg}`,
      );

      if (error instanceof CircuitOpenError) {
        throw new ServiceUnavailableException(
          'Cover image generation is temporarily unavailable. Please try again in a minute.',
        );
      }

      // A non-retryable 4xx from the Hugging Face provider itself means
      // "try again" is actively misleading — the request will keep failing
      // until the model/provider config or account billing is fixed, not
      // because of load. Confirmed live against the HF router: the
      // `hf-inference` provider now returns 410 Gone for this model (it has
      // dropped free serverless support for it), and the remaining live
      // providers (fal-ai, nscale, wavespeed) return 402-style "no remaining
      // credits" errors for this account. withRetry already skips retrying
      // these (isTransientError only retries 429/5xx), so surface that
      // distinction to the caller too instead of the generic 500.
      if (
        isAxiosError(error) &&
        error.response?.status !== undefined &&
        error.response.status >= 400 &&
        error.response.status < 500 &&
        error.response.status !== 429 &&
        error.response.status !== 408
      ) {
        throw new ServiceUnavailableException(
          'The image generation provider is currently unavailable. Retrying will not help — please contact support.',
        );
      }

      throw new InternalServerErrorException(
        `Failed to generate ${kind} cover image. Please try again.`,
      );
    }
  }
}
