import { Test, TestingModule } from '@nestjs/testing';
import {
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { GeminiService, GenerateStoryOptions } from './gemini.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { UploadService } from '../upload/upload.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';

/** Minimal valid story JSON the mocked Gemini client returns. */
const VALID_STORY_JSON = JSON.stringify({
  title: 'A Brave Little Star',
  description: 'A tale of courage',
  difficultyLevel: 2,
  estimatedWordCount: 300,
  content: 'Once upon a time...',
  questions: Array.from({ length: 5 }, (_, i) => ({
    question: `Q${i}?`,
    options: ['A', 'B', 'C', 'D'],
    answer: 0,
  })),
});

const STORY_OPTIONS: GenerateStoryOptions = {
  theme: ['Adventure'],
  category: ['Fantasy'],
  ageMin: 4,
  ageMax: 8,
  language: 'English',
};

describe('GeminiService', () => {
  let service: GeminiService;
  let cbService: CircuitBreakerService;
  let generateContent: jest.Mock;
  let httpPost: jest.Mock;

  beforeEach(async () => {
    generateContent = jest.fn();
    httpPost = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        CircuitBreakerService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-key') },
        },
        {
          provide: HttpService,
          useValue: { post: httpPost },
        },
        {
          provide: VoiceQuotaService,
          useValue: {
            trackGeminiStory: jest.fn().mockResolvedValue(undefined),
            trackGeminiImage: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UploadService,
          useValue: {
            uploadImageFromBuffer: jest
              .fn()
              .mockResolvedValue({ secure_url: 'https://cdn/cover.png' }),
          },
        },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
    cbService = module.get<CircuitBreakerService>(CircuitBreakerService);

    // The GoogleGenAI client is constructed internally; replace its models.
    (service as unknown as { genAI: { models: unknown } }).genAI = {
      models: { generateContent },
    };
  });

  describe('generateStory circuit breaker', () => {
    it('opens the shared "gemini" breaker after 5 transient (503) failures and then fast-fails', async () => {
      generateContent.mockRejectedValue({ status: 503 });

      // 5 transient failures should trip the breaker.
      for (let i = 0; i < 5; i++) {
        await expect(service.generateStory(STORY_OPTIONS)).rejects.toThrow(
          ServiceUnavailableException,
        );
      }

      const breaker = cbService.getBreaker('gemini');
      expect(breaker.getSnapshot().state).toBe(CircuitState.OPEN);

      // 6th call must fast-fail WITHOUT invoking the Gemini client.
      generateContent.mockClear();
      await expect(service.generateStory(STORY_OPTIONS)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('does NOT trip the breaker on a 400 (non-transient) error', async () => {
      generateContent.mockRejectedValue({ status: 400 });

      for (let i = 0; i < 6; i++) {
        await expect(service.generateStory(STORY_OPTIONS)).rejects.toThrow(
          InternalServerErrorException,
        );
      }

      const breaker = cbService.getBreaker('gemini');
      expect(breaker.getSnapshot().state).toBe(CircuitState.CLOSED);
    });

    it('does NOT trip the breaker on a JSON parse error', async () => {
      generateContent.mockResolvedValue({ text: 'not valid json {' });

      for (let i = 0; i < 6; i++) {
        await expect(service.generateStory(STORY_OPTIONS)).rejects.toThrow(
          InternalServerErrorException,
        );
      }

      const breaker = cbService.getBreaker('gemini');
      expect(breaker.getSnapshot().state).toBe(CircuitState.CLOSED);
    });

    it('returns a parsed story on success and keeps the breaker closed', async () => {
      generateContent.mockResolvedValue({ text: VALID_STORY_JSON });

      const story = await service.generateStory(STORY_OPTIONS);

      expect(story.title).toBe('A Brave Little Star');
      expect(story.theme).toEqual(['Adventure']);
      expect(cbService.getBreaker('gemini').getSnapshot().state).toBe(
        CircuitState.CLOSED,
      );
    });
  });

  describe('generateStoryImage resilience', () => {
    it('returns the uploaded cover url on success', async () => {
      const bigBuffer = Buffer.alloc(2048, 1);
      httpPost.mockReturnValue(of({ data: bigBuffer }));

      const url = await service.generateStoryImage('Title', 'Desc');

      expect(url).toBe('https://cdn/cover.png');
    });

    it('maps a CircuitOpenError to a ServiceUnavailableException (temporarily unavailable cover image)', async () => {
      httpPost.mockReturnValue(throwError(() => ({ status: 503 })));

      // Trip the hf-image breaker (threshold 5). Each call retries then fails.
      for (let i = 0; i < 5; i++) {
        await expect(
          service.generateStoryImage('Title', 'Desc'),
        ).rejects.toThrow(InternalServerErrorException);
      }

      expect(cbService.getBreaker('hf-image').getSnapshot().state).toBe(
        CircuitState.OPEN,
      );

      // Now the breaker is OPEN: the call should fast-fail as unavailable.
      await expect(service.generateStoryImage('Title', 'Desc')).rejects.toThrow(
        ServiceUnavailableException,
      );
    }, 20000);

    it('maps a non-transient HF failure to InternalServerErrorException', async () => {
      httpPost.mockReturnValue(throwError(() => ({ status: 400 })));

      await expect(service.generateStoryImage('Title', 'Desc')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
