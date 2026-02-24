import { Test, TestingModule } from '@nestjs/testing';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import { STORY_REPOSITORY } from '../story/repositories/story.repository.interface';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceQuotaService } from './voice-quota.service';
import { VoiceQueueService } from './queue';

const mockVoiceService = {
  listVoices: jest.fn(),
  fetchAvailableVoices: jest.fn(),
};

const mockStoryRepository = {
  findStoryById: jest.fn(),
};
const mockUploadService = {};
const mockTextToSpeechService = {};
const mockSpeechToTextService = {};
const mockVoiceQuotaService = {
  checkUsage: jest.fn(),
  canUseVoice: jest.fn(),
  getVoiceAccess: jest.fn(),
  setSecondVoice: jest.fn(),
};
const mockVoiceQueueService = {
  queueTextSynthesis: jest.fn(),
  queueStorySynthesis: jest.fn(),
  getJobStatus: jest.fn(),
  getJobResult: jest.fn(),
  cancelJob: jest.fn(),
  getUserPendingJobs: jest.fn(),
  getQueueStats: jest.fn(),
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
        { provide: STORY_REPOSITORY, useValue: mockStoryRepository },
        { provide: UploadService, useValue: mockUploadService },
        { provide: TextToSpeechService, useValue: mockTextToSpeechService },
        { provide: SpeechToTextService, useValue: mockSpeechToTextService },
        { provide: VoiceQuotaService, useValue: mockVoiceQuotaService },
        { provide: VoiceQueueService, useValue: mockVoiceQueueService },
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
});
