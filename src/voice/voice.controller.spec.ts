import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import { StoryService } from '../story/story.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceQuotaService } from './voice-quota.service';
import { StoryQuotaService } from '@/story/story-quota.service';
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import { GuestSessionService } from '@/guest/guest-session.service';

const mockVoiceService = {
  listVoices: jest.fn(),
  fetchAvailableVoices: jest.fn(),
};

const mockStoryService = {
  getStoryById: jest.fn(),
};
const mockUploadService = {};
const mockTextToSpeechService = {
  batchTextToSpeechEager: jest.fn(),
};
const mockSpeechToTextService = {};
const mockVoiceQuotaService = {
  canUseVoice: jest.fn().mockResolvedValue(true),
  getVoiceAccess: jest.fn(),
};
const mockStoryQuotaService = {
  checkStoryAccess: jest
    .fn()
    .mockResolvedValue({ canAccess: true, reason: 'premium' }),
  recordNewStoryAccess: jest.fn().mockResolvedValue(undefined),
};
const mockTtsBatchQueueService = {
  queueBatch: jest.fn().mockResolvedValue('batch-id'),
  getBatchStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
};
const mockGuestSessionService = {
  getGuestSession: jest
    .fn()
    .mockResolvedValue({ id: 'guest-1', userId: 'guest-1' }),
  recordNewStoryAccess: jest.fn().mockResolvedValue({ recorded: true }),
};

describe('VoiceController', () => {
  let controller: VoiceController;
  let service: typeof mockVoiceService;

  const mockRequest = {
    authUserData: { userId: 'user-1' },
  } as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        { provide: VoiceService, useValue: mockVoiceService },
        { provide: StoryService, useValue: mockStoryService },
        { provide: UploadService, useValue: mockUploadService },
        { provide: TextToSpeechService, useValue: mockTextToSpeechService },
        { provide: SpeechToTextService, useValue: mockSpeechToTextService },
        { provide: VoiceQuotaService, useValue: mockVoiceQuotaService },
        { provide: StoryQuotaService, useValue: mockStoryQuotaService },
        { provide: TtsBatchQueueService, useValue: mockTtsBatchQueueService },
        { provide: GuestSessionService, useValue: mockGuestSessionService },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<VoiceController>(VoiceController);
    service = module.get(VoiceService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listVoices', () => {
    it('should return all user voices', async () => {
      const expectedResult = [{ id: 'voice-1' }];
      service.listVoices.mockResolvedValue(expectedResult);

      const result = await controller.listVoices(mockRequest);
      expect(result).toEqual(expectedResult);
      expect(service.listVoices).toHaveBeenCalledWith('user-1');
    });
  });

  describe('listAvailableVoices', () => {
    it('should return all available ElevenLabs voices', async () => {
      const expectedResult = [{ id: 'eleven-voice-1' }];
      service.fetchAvailableVoices.mockResolvedValue(expectedResult);

      const result = await controller.listAvailableVoices();
      expect(result).toEqual(expectedResult);
      expect(service.fetchAvailableVoices).toHaveBeenCalled();
    });
  });

  describe('batchTextToSpeech', () => {
    const eagerResult = {
      results: [
        { index: 0, text: 'Hello world', audioUrl: 'https://audio.com/a.mp3' },
      ],
      totalParagraphs: 1,
      wasTruncated: false,
      usedProvider: 'deepgram',
      remainingUncached: [],
      batchProvider: 'deepgram',
      isPremium: true,
    };

    it('should generate batch audio when voice access is allowed', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({ canAccess: true, reason: 'premium' });
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world',
      });
      mockTextToSpeechService.batchTextToSpeechEager.mockResolvedValue(
        eagerResult,
      );

      const result = await controller.batchTextToSpeech(
        { storyId: 'story-1', voiceId: 'MILO' },
        mockRequest,
      );

      expect(mockVoiceQuotaService.canUseVoice).toHaveBeenCalledWith(
        'user-1',
        'MILO',
      );
      expect(result.paragraphs).toHaveLength(1);
      expect(result.voiceId).toBe('MILO');
    });

    it('should include usedProvider and preferredProvider in the response', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({ canAccess: true, reason: 'premium' });
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world',
      });
      mockTextToSpeechService.batchTextToSpeechEager.mockResolvedValue({
        ...eagerResult,
        preferredProvider: 'elevenlabs',
      });

      const result = await controller.batchTextToSpeech(
        { storyId: 'story-1', voiceId: 'MILO' },
        mockRequest,
      );

      expect(result.usedProvider).toBe('deepgram');
      expect(result.preferredProvider).toBe('elevenlabs');
    });

    it('should omit preferredProvider when no fallback occurred', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({ canAccess: true, reason: 'premium' });
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world',
      });
      mockTextToSpeechService.batchTextToSpeechEager.mockResolvedValue(
        eagerResult,
      );

      const result = await controller.batchTextToSpeech(
        { storyId: 'story-1', voiceId: 'MILO' },
        mockRequest,
      );

      expect(result.usedProvider).toBe('deepgram');
      expect(result.preferredProvider).toBeUndefined();
    });

    it('should include providerStatus when service reports degraded', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({ canAccess: true, reason: 'premium' });
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world',
      });
      mockTextToSpeechService.batchTextToSpeechEager.mockResolvedValue({
        ...eagerResult,
        preferredProvider: 'elevenlabs',
        providerStatus: 'degraded',
      });

      const result = await controller.batchTextToSpeech(
        { storyId: 'story-1', voiceId: 'MILO' },
        mockRequest,
      );

      expect(result.providerStatus).toBe('degraded');
      expect(result.preferredProvider).toBe('elevenlabs');
    });

    it('should omit providerStatus when providers are healthy', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({ canAccess: true, reason: 'premium' });
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world',
      });
      mockTextToSpeechService.batchTextToSpeechEager.mockResolvedValue({
        ...eagerResult,
        usedProvider: 'elevenlabs',
      });

      const result = await controller.batchTextToSpeech(
        { storyId: 'story-1', voiceId: 'MILO' },
        mockRequest,
      );

      expect(result.providerStatus).toBeUndefined();
    });

    it('should throw 403 when free user picks a disallowed voice in batch', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(false);

      await expect(
        controller.batchTextToSpeech(
          { storyId: 'story-1', voiceId: 'BELLA' },
          mockRequest,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockStoryService.getStoryById).not.toHaveBeenCalled();
      expect(
        mockTextToSpeechService.batchTextToSpeechEager,
      ).not.toHaveBeenCalled();
    });

    it('should throw 403 when story quota is exceeded', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world',
      });
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({
        canAccess: false,
        reason: 'quota_exceeded',
      });

      await expect(
        controller.batchTextToSpeech(
          { storyId: 'story-1', voiceId: 'MILO' },
          mockRequest,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        mockTextToSpeechService.batchTextToSpeechEager,
      ).not.toHaveBeenCalled();
    });

    it('should queue remaining uncached paragraphs', async () => {
      mockVoiceQuotaService.canUseVoice.mockResolvedValue(true);
      mockStoryService.getStoryById.mockResolvedValue({
        id: 'story-1',
        textContent: 'Hello world paragraph 1. Paragraph 2. Paragraph 3.',
      });
      mockStoryQuotaService.checkStoryAccess.mockResolvedValue({ canAccess: true, reason: 'premium' });
      mockTextToSpeechService.batchTextToSpeechEager.mockResolvedValue({
        ...eagerResult,
        remainingUncached: [{ index: 1, text: 'Paragraph 2' }],
      });

      const result = await controller.batchTextToSpeech(
        { storyId: 'story-1', voiceId: 'MILO' },
        mockRequest,
      );

      expect(mockTtsBatchQueueService.queueBatch).toHaveBeenCalled();
      expect(result.batchJobId).toBe('batch-id');
      expect(result.pendingParagraphs).toBe(1);
    });
  });
});
