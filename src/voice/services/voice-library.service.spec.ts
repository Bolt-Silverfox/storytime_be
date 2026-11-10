import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { VoiceLibraryService } from './voice-library.service';
import { VoiceResponseMapper } from './voice-response.mapper';
import { ElevenLabsTTSProvider } from '../providers/eleven-labs-tts.provider';
import { VOICE_REPOSITORY, IVoiceRepository } from '../repositories';
import { SubscriptionService } from '@/subscription/subscription.service';
import { UploadService } from '@/upload/upload.service';
import { MAX_CUSTOM_VOICES_PER_USER } from '../voice.constants';
import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
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
  createUploadedVoiceWithinCap: jest.fn(),
  updateVoice: jest.fn(),
  hardDeleteVoice: jest.fn(),
};

const mockSubscriptionService = { isPremiumUser: jest.fn() };
const mockUploadService = { uploadFile: jest.fn(), deleteAudio: jest.fn() };

const mockConfigService = {
  get: jest.fn(),
};

const mockHttpService = {
  get: jest.fn(),
};

const mockElevenLabsProvider = {
  addVoice: jest.fn(),
  deleteVoice: jest.fn(),
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
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: UploadService, useValue: mockUploadService },
      ],
    }).compile();

    service = module.get<VoiceLibraryService>(VoiceLibraryService);
  });

  describe('findOrCreateElevenLabsVoice resilience', () => {
    const UNKNOWN_ID = 'test-unknown-eleven-id';
    const USER_ID = 'user-1';

    beforeEach(() => {
      // No local match → force the ElevenLabs HTTP fetch path.
      mockVoiceRepository.findFirstByUserAndElevenLabsId.mockResolvedValue(
        null,
      );
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

  describe('uploadVoiceFile', () => {
    const file = { buffer: Buffer.from('audio') } as Express.Multer.File;
    const dto = { name: 'Dad' };
    const reserved = {
      id: 'v1',
      userId: 'user-1',
      name: 'Dad',
      type: 'uploaded',
    };

    beforeEach(() => {
      mockSubscriptionService.isPremiumUser.mockResolvedValue(true);
      mockVoiceRepository.createUploadedVoiceWithinCap.mockResolvedValue(
        reserved,
      );
      mockUploadService.uploadFile.mockResolvedValue({
        secure_url: 'https://cdn/x.mp3',
        public_id: 'storytime/x',
        resource_type: 'video',
      });
      mockElevenLabsProvider.deleteVoice.mockResolvedValue(undefined);
      mockUploadService.deleteAudio.mockResolvedValue(undefined);
      mockElevenLabsProvider.addVoice.mockResolvedValue('el-1');
      mockVoiceRepository.updateVoice.mockResolvedValue({
        ...reserved,
        url: 'https://cdn/x.mp3',
        elevenLabsVoiceId: 'el-1',
      });
      mockVoiceRepository.hardDeleteVoice.mockResolvedValue(undefined);
    });

    it('rejects a non-premium user with 403 before any upload, clone or write', async () => {
      mockSubscriptionService.isPremiumUser.mockResolvedValue(false);

      await expect(
        service.uploadVoiceFile('user-1', file, dto),
      ).rejects.toThrow(ForbiddenException);

      expect(
        mockVoiceRepository.createUploadedVoiceWithinCap,
      ).not.toHaveBeenCalled();
      expect(mockUploadService.uploadFile).not.toHaveBeenCalled();
      expect(mockElevenLabsProvider.addVoice).not.toHaveBeenCalled();
    });

    it('reserves a slot under the premium cap, then uploads, clones and stores the voice', async () => {
      const result = await service.uploadVoiceFile('user-1', file, dto);

      expect(
        mockVoiceRepository.createUploadedVoiceWithinCap,
      ).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ userId: 'user-1', name: 'Dad' }),
        MAX_CUSTOM_VOICES_PER_USER,
      );
      expect(mockVoiceRepository.updateVoice).toHaveBeenCalledWith('v1', {
        url: 'https://cdn/x.mp3',
        elevenLabsVoiceId: 'el-1',
      });
      expect(result.cloudinary).toEqual({
        url: 'https://cdn/x.mp3',
        publicId: 'storytime/x',
      });
      expect(result.voice.id).toBe('v1');
    });

    it('returns 403 and does not upload when the cap is already reached', async () => {
      mockVoiceRepository.createUploadedVoiceWithinCap.mockResolvedValue(null);

      await expect(
        service.uploadVoiceFile('user-1', file, dto),
      ).rejects.toThrow(ForbiddenException);

      expect(mockUploadService.uploadFile).not.toHaveBeenCalled();
      expect(mockElevenLabsProvider.addVoice).not.toHaveBeenCalled();
    });

    it('deletes the Cloudinary file and the reserved row when the clone fails', async () => {
      mockElevenLabsProvider.addVoice.mockRejectedValue(new Error('boom'));

      await expect(
        service.uploadVoiceFile('user-1', file, dto),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockUploadService.deleteAudio).toHaveBeenCalledWith(
        'storytime/x',
        'video',
      );
      expect(mockVoiceRepository.hardDeleteVoice).toHaveBeenCalledWith('v1');
      expect(mockVoiceRepository.updateVoice).not.toHaveBeenCalled();
      expect(mockElevenLabsProvider.deleteVoice).not.toHaveBeenCalled();
    });

    it('deletes the Cloudinary file with the resource type it was uploaded as', async () => {
      mockUploadService.uploadFile.mockResolvedValue({
        secure_url: 'https://cdn/x.png',
        public_id: 'storytime/x',
        resource_type: 'image',
      });
      mockElevenLabsProvider.addVoice.mockRejectedValue(new Error('boom'));

      await expect(
        service.uploadVoiceFile('user-1', file, dto),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockUploadService.deleteAudio).toHaveBeenCalledWith(
        'storytime/x',
        'image',
      );
    });

    it('deletes the cloned ElevenLabs voice, the file and the row when saving the voice fails', async () => {
      const failure = new Error('db down');
      mockVoiceRepository.updateVoice.mockRejectedValue(failure);

      await expect(service.uploadVoiceFile('user-1', file, dto)).rejects.toBe(
        failure,
      );

      expect(mockElevenLabsProvider.deleteVoice).toHaveBeenCalledWith('el-1');
      expect(mockUploadService.deleteAudio).toHaveBeenCalledWith(
        'storytime/x',
        'video',
      );
      expect(mockVoiceRepository.hardDeleteVoice).toHaveBeenCalledWith('v1');
    });

    it('logs and still reports the original error when deleting the cloned voice fails', async () => {
      const failure = new Error('db down');
      mockVoiceRepository.updateVoice.mockRejectedValue(failure);
      mockElevenLabsProvider.deleteVoice.mockRejectedValue(
        new Error('elevenlabs down'),
      );
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(service.uploadVoiceFile('user-1', file, dto)).rejects.toBe(
        failure,
      );

      expect(logged).toHaveBeenCalledWith(expect.stringContaining('el-1'));
      expect(mockVoiceRepository.hardDeleteVoice).toHaveBeenCalledWith('v1');
      logged.mockRestore();
    });

    it('still releases the reserved row and reports the clone failure when Cloudinary cleanup fails', async () => {
      mockElevenLabsProvider.addVoice.mockRejectedValue(new Error('boom'));
      mockUploadService.deleteAudio.mockRejectedValue(new Error('cdn down'));

      await expect(
        service.uploadVoiceFile('user-1', file, dto),
      ).rejects.toThrow('Voice cloning failed');

      expect(mockVoiceRepository.hardDeleteVoice).toHaveBeenCalledWith('v1');
    });

    it('releases the reserved row when the Cloudinary upload itself fails', async () => {
      mockUploadService.uploadFile.mockRejectedValue(new Error('cdn down'));

      await expect(
        service.uploadVoiceFile('user-1', file, dto),
      ).rejects.toThrow();

      expect(mockVoiceRepository.hardDeleteVoice).toHaveBeenCalledWith('v1');
      expect(mockUploadService.deleteAudio).not.toHaveBeenCalled();
    });
  });
});
