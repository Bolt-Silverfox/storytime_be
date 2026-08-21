import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { VoiceLibraryService } from './voice-library.service';
import { VoiceResponseMapper } from './voice-response.mapper';
import { ElevenLabsTTSProvider } from '../providers/eleven-labs-tts.provider';
import { VOICE_REPOSITORY, IVoiceRepository } from '../repositories';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

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

// Controllable fake breaker so we can drive OPEN vs CLOSED per-test.
const mockBreaker = {
  name: 'voice-library',
  canExecute: jest.fn().mockReturnValue(true),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
};

const mockCbService = {
  getBreaker: jest.fn().mockReturnValue(mockBreaker),
};

describe('VoiceLibraryService', () => {
  let service: VoiceLibraryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBreaker.canExecute.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceLibraryService,
        VoiceResponseMapper,
        { provide: VOICE_REPOSITORY, useValue: mockVoiceRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ElevenLabsTTSProvider, useValue: mockElevenLabsProvider },
        { provide: CircuitBreakerService, useValue: mockCbService },
      ],
    }).compile();

    service = module.get<VoiceLibraryService>(VoiceLibraryService);
  });

  describe('findOrCreateElevenLabsVoice resilience', () => {
    const UNKNOWN_ID = 'test-unknown-eleven-id';
    const USER_ID = 'user-1';

    beforeEach(() => {
      // No local match → force the ElevenLabs HTTP fetch path.
      mockVoiceRepository.findFirstByUserAndElevenLabsId.mockResolvedValue(null);
      mockVoiceRepository.createVoice.mockResolvedValue({ id: 'new-voice-id' });
      mockConfigService.get.mockReturnValue('fake-key');
    });

    it('retries a transient failure then surfaces to the existing fallback', async () => {
      // Every attempt fails with a retryable 503.
      mockHttpService.get.mockReturnValue(throwError(() => ({ status: 503 })));

      const result = await service.findOrCreateElevenLabsVoice(
        UNKNOWN_ID,
        USER_ID,
      );

      // Retried: 1 initial + 2 retries = 3 calls (> 1 proves retry happened).
      expect(mockHttpService.get.mock.calls.length).toBeGreaterThan(1);
      // Existing behavior preserved: falls back and still persists the voice.
      expect(mockVoiceRepository.createVoice).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Imported ElevenLabs Voice',
          elevenLabsVoiceId: UNKNOWN_ID,
        }),
      );
      expect(result).toEqual({ id: 'new-voice-id' });
    });

    it('fast-fails when the breaker is OPEN without calling httpService', async () => {
      mockBreaker.canExecute.mockReturnValue(false);

      const result = await service.findOrCreateElevenLabsVoice(
        UNKNOWN_ID,
        USER_ID,
      );

      // Breaker OPEN → external call is never attempted.
      expect(mockHttpService.get).not.toHaveBeenCalled();
      // CircuitOpenError translated into the existing graceful fallback.
      expect(mockVoiceRepository.createVoice).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Imported ElevenLabs Voice',
          elevenLabsVoiceId: UNKNOWN_ID,
        }),
      );
      expect(result).toEqual({ id: 'new-voice-id' });
    });

    it('uses the fetched voice details on a successful response', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          status: 200,
          data: { name: 'Harry', preview_url: 'https://preview/harry.mp3' },
        }),
      );

      const result = await service.findOrCreateElevenLabsVoice(
        UNKNOWN_ID,
        USER_ID,
      );

      expect(mockHttpService.get).toHaveBeenCalledTimes(1);
      expect(mockVoiceRepository.createVoice).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Harry',
          url: 'https://preview/harry.mp3',
          elevenLabsVoiceId: UNKNOWN_ID,
        }),
      );
      expect(result).toEqual({ id: 'new-voice-id' });
    });
  });
});
