import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from './voice.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { ElevenLabsTTSProvider } from './providers/eleven-labs-tts.provider';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { VoiceResponseMapper } from './services/voice-response.mapper';
import { VoiceCatalogService } from './services/voice-catalog.service';
import { VoicePreferenceService } from './services/voice-preference.service';
import { VoiceLibraryService } from './services/voice-library.service';
import {
  VOICE_REPOSITORY,
  IVoiceRepository,
  VOICE_USER_REPOSITORY,
  IVoiceUserRepository,
} from './repositories';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockVoiceRepository: Record<keyof IVoiceRepository, jest.Mock> = {
  createVoice: jest.fn(),
  createVoiceReturningId: jest.fn(),
  findManyByUserNotDeleted: jest.fn(),
  findFirstByUserAndElevenLabsId: jest.fn(),
  findSystemVoiceByElevenLabsId: jest.fn(),
  findFirstByIdNotDeleted: jest.fn(),
  findSystemVoicesByElevenLabsIds: jest.fn(),
  findUniqueByIdNotDeleted: jest.fn(),
  findSystemVoiceIdByElevenLabsId: jest.fn(),
  findVoiceIdElevenLabsPairs: jest.fn(),
  findElevenLabsIdById: jest.fn(),
};

const mockVoiceUserRepository: Record<keyof IVoiceUserRepository, jest.Mock> = {
  updatePreferredVoiceWithInclude: jest.fn(),
  findByIdWithPreferredVoice: jest.fn(),
  findPreferredVoiceId: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockHttpService = {
  get: jest.fn(),
};

const mockElevenLabsProvider = {
  addVoice: jest.fn(),
  getVoices: jest.fn(),
};

describe('VoiceService', () => {
  let service: VoiceService;
  let voiceRepository: typeof mockVoiceRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        VoiceResponseMapper,
        VoiceCatalogService,
        VoicePreferenceService,
        VoiceLibraryService,
        { provide: VOICE_REPOSITORY, useValue: mockVoiceRepository },
        { provide: VOICE_USER_REPOSITORY, useValue: mockVoiceUserRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ElevenLabsTTSProvider, useValue: mockElevenLabsProvider },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        {
          provide: CircuitBreakerService,
          useValue: {
            getBreaker: jest.fn().mockReturnValue({
              name: 'voice-library',
              canExecute: jest.fn().mockReturnValue(true),
              recordSuccess: jest.fn(),
              recordFailure: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
    voiceRepository = module.get(VOICE_REPOSITORY);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listVoices', () => {
    it('should return all voices for a user', async () => {
      const userId = 'user-1';
      const userVoices = [
        {
          id: 'voice-1',
          name: 'Custom Voice',
          type: 'uploaded',
          url: 'http://url',
          elevenLabsVoiceId: null,
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      voiceRepository.findManyByUserNotDeleted.mockResolvedValue(userVoices);

      const result = await service.listVoices(userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'voice-1',
        name: 'Custom Voice',
      });

      expect(voiceRepository.findManyByUserNotDeleted).toHaveBeenCalledWith(
        userId,
      );
    });
  });
});
