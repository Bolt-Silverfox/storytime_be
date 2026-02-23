import { Test, TestingModule } from '@nestjs/testing';
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

const mockVoiceService = {
  listVoices: jest.fn(),
  fetchAvailableVoices: jest.fn(),
};

const mockStoryService = {};
const mockUploadService = {};
const mockTextToSpeechService = {};
const mockSpeechToTextService = {};
const mockVoiceQuotaService = {
  canUseVoice: jest.fn().mockResolvedValue(true),
  getVoiceAccess: jest.fn(),
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
