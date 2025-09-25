import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GenerateStoryOptions {
  theme: string[];
  category: string[];
  ageMin: number;
  ageMax: number;
  language?: string;
  kidName?: string;
  additionalContext?: string;
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
  ageMin: number;
  ageMax: number;
  language: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenerativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured. Story generation will not be available.');
      return;
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateStory(options: GenerateStoryOptions): Promise<GeneratedStory> {
    if (!this.genAI) {
      throw new Error('Gemini API is not configured. Please set GEMINI_API_KEY environment variable.');
    }

    const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = this.buildPrompt(options);

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse the JSON response
      const story = JSON.parse(text);

      // Validate the response structure
      if (!this.validateStoryStructure(story)) {
        throw new Error('Invalid story structure received from Gemini');
      }

      return {
        ...story,
        theme: options.theme,
        category: options.category,
        ageMin: options.ageMin,
        ageMax: options.ageMax,
        language: options.language || 'English'
      };
    } catch (error) {
      this.logger.error('Failed to generate story with Gemini:', error);
      throw error;
    }
  }

  private buildPrompt(options: GenerateStoryOptions): string {
    const kidNamePart = options.kidName ? `The main character should be named ${options.kidName}.` : '';
    const contextPart = options.additionalContext ? `Additional context: ${options.additionalContext}` : '';

    return `Generate a children's story with the following requirements:

Theme(s): ${options.theme.join(', ')}
Category(s): ${options.category.join(', ')}
Age range: ${options.ageMin} to ${options.ageMax} years old
Language: ${options.language || 'English'}
${kidNamePart}
${contextPart}

The story should be:
- Age-appropriate with vocabulary and concepts suitable for ${options.ageMin}-${options.ageMax} year olds
- Engaging and educational
- Between 300-500 words
- Have a clear beginning, middle, and end
- Include a positive message or lesson
- Use vivid descriptions and imagery

Generate the response as a valid JSON object with this exact structure:
{
  "title": "Story title",
  "description": "A brief 1-2 sentence description of the story",
  "content": "The full story text with paragraphs separated by \\n\\n",
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

    if (!Array.isArray(story.questions) || story.questions.length < 1) return false;

    for (const question of story.questions) {
      if (!question.question || !Array.isArray(question.options) ||
          question.options.length !== 4 ||
          typeof question.answer !== 'number' ||
          question.answer < 0 || question.answer > 3) {
        return false;
      }
    }

    return true;
  }

  async generateStoryImage(title: string, description: string): Promise<string> {
    // For now, return a placeholder image URL
    // In production, you might integrate with an image generation service
    return 'https://res.cloudinary.com/billmal/image/upload/v1750973099/storytime/generated_story.webp';
  }
}