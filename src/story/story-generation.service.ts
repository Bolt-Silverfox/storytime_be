import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Prisma } from '@prisma/client';
import { STORY_REPOSITORY, IStoryRepository } from './repositories';
import {
  GeminiService,
  GenerateStoryOptions,
  GeneratedStory,
} from './gemini.service';
import { TextToSpeechService } from './text-to-speech.service';
import { VoiceType } from '../voice/dto/voice.dto';
import { DEFAULT_VOICE } from '../voice/voice.constants';
import { STORY_INVALIDATION_KEYS } from '@/shared/constants/cache-keys.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents, StoryCreatedEvent } from '@/shared/events';

@Injectable()
export class StoryGenerationService {
  private readonly logger = new Logger(StoryGenerationService.name);

  // Average reading speed for children: ~150 words per minute
  private readonly WORDS_PER_MINUTE = 150;

  constructor(
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly geminiService: GeminiService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * Calculate estimated reading duration in seconds based on text content or word count
   */
  calculateDurationSeconds(textOrWordCount: string | number): number {
    const wordCount =
      typeof textOrWordCount === 'string'
        ? textOrWordCount.split(/\s+/).filter((word) => word.length > 0).length
        : textOrWordCount;

    if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;

    // Convert words per minute to seconds: (wordCount / wordsPerMinute) * 60
    return Math.ceil((wordCount / this.WORDS_PER_MINUTE) * 60);
  }

  /** Invalidate all story-related caches */
  private async invalidateStoryCaches(): Promise<void> {
    try {
      await Promise.all(
        STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate story caches: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Generate a story using AI with provided options
   */
  async generateStoryWithAI(options: GenerateStoryOptions) {
    // Resolve Season IDs to names if needed for AI context
    if (
      options.seasonIds &&
      options.seasonIds.length > 0 &&
      (!options.seasons || options.seasons.length === 0)
    ) {
      const seasons = await this.storyRepository.findSeasonsByIds(
        options.seasonIds,
      );
      options.seasons = seasons.map((s) => s.name);
    }

    // 1. Generate Story Content
    const generatedStory = await this.geminiService.generateStory(options);

    // 2. Persist with Image & Audio
    return this.persistGeneratedStory(
      generatedStory,
      options.kidName || 'Hero',
      options.creatorKidId,
      options.voiceType,
      options.seasonIds,
    );
  }

  /**
   * Generate a personalized story for a specific kid
   */
  async generateStoryForKid(
    kidId: string,
    themeNames?: string[],
    categoryNames?: string[],
    seasonIds?: string[],
    kidName?: string,
  ) {
    const kid = await this.storyRepository.findKidByIdWithPreferences(kidId);

    if (!kid) {
      throw new NotFoundException(`Kid with id ${kidId} not found`);
    }

    // 1. Setup options (existing logic)
    let ageMin = 4;
    let ageMax = 8;
    if (kid.ageRange && typeof kid.ageRange === 'string') {
      const match = kid.ageRange.match(/(\d+)-?(\d+)?/);
      if (match) {
        ageMin = parseInt(match[1], 10);
        ageMax = match[2] ? parseInt(match[2], 10) : ageMin + 2;
      }
    }

    let themes = themeNames || [];
    let categories = categoryNames || [];

    // Add kid's preferred categories
    if (kid.preferredCategories && kid.preferredCategories.length > 0) {
      const prefCategoryNames = kid.preferredCategories.map((c) => c.name);
      categories = [...new Set([...categories, ...prefCategoryNames])];
    }

    // Batch fetch themes and categories if needed (avoid sequential queries)
    const needThemes = themes.length === 0;
    const needCategories = categories.length === 0;

    if (needThemes || needCategories) {
      const [availableThemes, availableCategories] = await Promise.all([
        needThemes ? this.storyRepository.findAllThemes() : Promise.resolve([]),
        needCategories
          ? this.storyRepository.findAllCategories()
          : Promise.resolve([]),
      ]);

      if (needThemes && availableThemes.length > 0) {
        const randomTheme =
          availableThemes[Math.floor(Math.random() * availableThemes.length)];
        themes = [randomTheme.name];
      }

      if (needCategories && availableCategories.length > 0) {
        const randomCategory =
          availableCategories[
          Math.floor(Math.random() * availableCategories.length)
          ];
        categories = [randomCategory.name];
      }
    }

    let contextString = '';
    if (kid.excludedTags && kid.excludedTags.length > 0) {
      const exclusions = kid.excludedTags.join(', ');
      contextString = `IMPORTANT: The story must strictly AVOID the following topics, themes, creatures, or elements: ${exclusions}. Ensure the content is safe and comfortable for the child regarding these exclusions.`;
    }

    let voiceType: VoiceType | undefined;
    if (kid.preferredVoice) {
      const voiceName = kid.preferredVoice.name.toUpperCase();
      if (voiceName in VoiceType) {
        voiceType = VoiceType[voiceName as keyof typeof VoiceType];
      } else if (kid.preferredVoice.elevenLabsVoiceId) {
        const elId = kid.preferredVoice.elevenLabsVoiceId.toUpperCase();
        if (elId in VoiceType) {
          voiceType = VoiceType[elId as keyof typeof VoiceType];
        }
      }
    }

    // Resolve Season IDs to Names for AI Context
    const seasonNames: string[] = [];
    if (seasonIds && seasonIds.length > 0) {
      const seasons = await this.storyRepository.findSeasonsByIds(seasonIds);
      seasonNames.push(...seasons.map((s) => s.name));
    }

    // Use parentId from already-fetched kid (avoid duplicate query)
    const userId = kid.parentId;

    const options: GenerateStoryOptions = {
      theme: themes,
      category: categories,
      seasons: seasonNames,
      ageMin,
      ageMax,
      kidName: kidName || kid.name || 'Hero',
      language: 'English',
      additionalContext: contextString,
      creatorKidId: kidId,
      voiceType,
      seasonIds: seasonIds,
      userId, // Pass resolved userId for usage tracking
    };

    this.logger.log(
      `Generating story for ${options.kidName}. Themes: [${themes.join(', ')}].`,
    );

    // 2. Generate Content via AI
    const generatedStory = await this.geminiService.generateStory(options);

    // 3. Persist (with Image & Audio) - calling shared helper
    return this.persistGeneratedStory(
      generatedStory,
      options.kidName!,
      kidId,
      voiceType,
      seasonIds,
    );
  }

  /**
   * Persist a generated story with image and audio
   */
  private async persistGeneratedStory(
    generatedStory: GeneratedStory & { textContent?: string },
    _kidName: string,
    creatorKidId?: string,
    voiceType?: VoiceType,
    seasonIds?: string[],
  ) {
    // Resolve userId for tracking if creatorKidId is present
    let userId: string | undefined;
    if (creatorKidId) {
      const kid = await this.storyRepository.findKidById(creatorKidId);
      if (kid) userId = kid.parentId;
    }

    // 1. Generate Cover Image (Pollinations) - external call, done first
    let coverImageUrl = '';
    try {
      this.logger.log(`Generating cover image for "${generatedStory.title}"`);
      coverImageUrl = this.geminiService.generateStoryImage(
        generatedStory.title,
        generatedStory.description || `A story about ${generatedStory.title}`,
        userId,
      );
    } catch (e) {
      this.logger.error(
        `Failed to generate story image: ${(e as Error).message}`,
      );
    }

    // 2. Prepare text content and calculate metrics
    const textContent =
      generatedStory.content ||
      generatedStory.textContent ||
      generatedStory.description ||
      '';
    const wordCount = textContent
      .split(/\s+/)
      .filter((word: string) => word.length > 0).length;
    const durationSeconds = this.calculateDurationSeconds(wordCount);

    // 3. Generate audio FIRST using a pre-generated story ID
    // This ensures we can create the story atomically with the audio URL
    const storyId = crypto.randomUUID();
    let audioUrl = '';

    if (textContent) {
      try {
        this.logger.log(`Generating audio for story ${storyId}`);
        audioUrl = await this.textToSpeechService.synthesizeStory(
          storyId,
          textContent,
          voiceType ?? DEFAULT_VOICE,
        );
      } catch (error) {
        this.logger.error(
          `Failed to generate audio for story ${storyId}: ${(error as Error).message}`,
        );
        // Continue without audio - story is still valid
      }
    }

    // 4. Prepare Relations (Categories/Themes)
    const categoryConnect =
      generatedStory.category?.map((c: string) => ({
        where: { name: c },
        create: { name: c, description: 'Auto-generated category' },
      })) || [];

    const themeConnect =
      generatedStory.theme?.map((t: string) => ({
        where: { name: t },
        create: { name: t, description: 'Auto-generated theme' },
      })) || [];

    // 5. Create Story atomically with all data including audio URL
    const story = await this.storyRepository.executeTransaction(
      async (tx: Prisma.TransactionClient) => {
        return tx.story.create({
          data: {
            id: storyId, // Use pre-generated ID that matches audio file
            title: generatedStory.title,
            description: generatedStory.description,
            language: generatedStory.language || 'English',
            ageMin: generatedStory.ageMin ?? 4,
            ageMax: generatedStory.ageMax ?? 8,
            isInteractive: false,
            coverImageUrl: coverImageUrl,
            textContent: textContent,
            wordCount: wordCount,
            durationSeconds: durationSeconds,
            audioUrl: audioUrl, // Already generated with pre-known ID
            creatorKidId: creatorKidId || null,
            aiGenerated: true,

            categories: { connectOrCreate: categoryConnect },
            themes: { connectOrCreate: themeConnect },
            seasons:
              seasonIds && seasonIds.length > 0
                ? {
                  connect: seasonIds.map((id) => ({ id })),
                }
                : generatedStory.seasons
                  ? {
                    connect: generatedStory.seasons.map((s: string) => ({
                      name: s,
                    })),
                  }
                  : undefined,
          },
          include: {
            images: true,
            branches: true,
            categories: true,
            themes: true,
            seasons: true,
          },
        });
      },
    );

    // Emit story created event
    const createdEvent: StoryCreatedEvent = {
      storyId: story.id,
      title: story.title,
      creatorKidId: story.creatorKidId || undefined,
      aiGenerated: story.aiGenerated,
      createdAt: story.createdAt,
    };
    this.eventEmitter.emit(AppEvents.STORY_CREATED, createdEvent);

    await this.invalidateStoryCaches();

    this.logger.log(`Story created: ${story.id} - "${story.title}"`);

    return story;
  }
}
