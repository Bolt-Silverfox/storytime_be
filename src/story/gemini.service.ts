import {
  Injectable, Logger, ServiceUnavailableException,
  InternalServerErrorException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { VoiceType } from '../voice/dto/voice.dto';
import { VoiceQuotaService } from '../voice/voice-quota.service';

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

  async generateStory(options: GenerateStoryOptions): Promise<GeneratedStory> {
    if (!this.genAI) {
      throw new Error(
        'Gemini API is not configured. Please set GEMINI_API_KEY environment variable.',
      );
    }

    // UPDATED: Changed model from 'gemini-1.5-flash' to 'gemini-2.5-flash'
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = this.buildPrompt(options);

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

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
        this.voiceQuotaService.trackGeminiStory(options.userId).catch(err =>
          this.logger.error(`Failed to track Gemini story usage for user ${options.userId}:`, err)
        );
      }

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

      // 1. Check for Network/Fetch errors
      if (error.message && (error.message.includes('fetch failed') || error.message.includes('ETIMEDOUT'))) {
        throw new ServiceUnavailableException(
          'We are having trouble connecting to the AI service right now. Please check your internet connection or try again in a moment.'
        );
      }

      // 2. Check for API Overload/Rate Limits
      if (error.status === 429 || error.status === 503) {
        throw new ServiceUnavailableException(
          'The AI storyteller is a bit busy right now. Please try again in 1 minute.'
        );
      }

      // 3. Fallback for other code errors
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

  private validateStoryStructure(story: any): boolean {
    if (!story || typeof story !== 'object') return false;

    const requiredFields = ['title', 'description', 'content', 'questions'];
    for (const field of requiredFields) {
      if (!story[field]) return false;
    }

    if (!Array.isArray(story.questions) || story.questions.length < 1)
      return false;

    for (const question of story.questions) {
      if (
        !question.question ||
        !Array.isArray(question.options) ||
        question.options.length !== 4 ||
        typeof question.answer !== 'number' ||
        question.answer < 0 ||
        question.answer > 3
      ) {
        return false;
      }
    }

    return true;
  }

  async generateStoryImage(
    title: string,
    description: string,
    userId?: string, // Added userId for tracking
  ): Promise<string> {
    const imagePrompt = `Children's story book cover for "${title}". ${description}. Colorful, vibrant, detailed, 4k, digital art style, friendly characters, magical atmosphere`;
    const encodedPrompt = encodeURIComponent(imagePrompt);
    const seed = Math.floor(Math.random() * 100000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;

    this.logger.log(`Generated Pollinations Image URL: ${imageUrl}`);

    // Track usage if userId is provided
    if (userId) {
      this.voiceQuotaService.trackGeminiImage(userId).catch(err =>
        this.logger.error(`Failed to track Gemini image usage for user ${userId}:`, err)
      );
    }

    return imageUrl;
  }
}