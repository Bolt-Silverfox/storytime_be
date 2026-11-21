import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { VoiceLibraryService } from './voice-library.service';
import { VoiceResponseMapper } from './voice-response.mapper';
import { ElevenLabsTTSProvider } from '../providers/eleven-labs-tts.provider';
import { VOICE_REPOSITORY, IVoiceRepository } from '../repositories';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { UploadService } from '@/upload/upload.service';
import { VOICE_CONFIG } from '../voice.constants';
import { VoiceType } from '../dto/voice.dto';

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
  findByIdAndUser: jest.fn(),
  softDeleteOwnedIfUnreferenced: jest.fn(),
  clearElevenLabsVoiceId: jest.fn(),
};

const mockUploadService = { releaseRecorded: jest.fn() };

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

  describe('uploadVoice', () => {
    it('records the Cloudinary public id on the voice', async () => {
      mockVoiceRepository.createVoice.mockResolvedValue({
        id: 'v1',
        name: 'Dad',
        type: 'uploaded',
        url: 'https://cdn/v.mp3',
      });

      await service.uploadVoice(
        'user-1',
        'https://cdn/v.mp3',
        { name: 'Dad' },
        undefined,
        'storytime/v',
      );

      expect(mockVoiceRepository.createVoice).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          url: 'https://cdn/v.mp3',
          publicId: 'storytime/v',
        }),
      );
    });
  });

  describe('deleteVoice', () => {
    const VOICE_ID = 'voice-1';
    const owned = (over: Record<string, unknown> = {}) => ({
      id: VOICE_ID,
      userId: 'user-1',
      publicId: 'storytime/v',
      isDeleted: false,
      ...over,
    });
    const steps: string[] = [];

    beforeEach(() => {
      steps.length = 0;
      mockVoiceRepository.findByIdAndUser.mockImplementation(
        (id: string, userId: string) =>
          Promise.resolve(
            id === VOICE_ID && userId === 'user-1' ? owned() : null,
          ),
      );
      mockVoiceRepository.findFirstByIdNotDeleted.mockResolvedValue(null);
      mockVoiceRepository.findSystemVoiceIdByElevenLabsId.mockResolvedValue(
        null,
      );
      mockElevenLabsProvider.deleteVoice.mockImplementation(() => {
        steps.push('deleteClone');
        return Promise.resolve();
      });
      mockVoiceRepository.clearElevenLabsVoiceId.mockImplementation(() => {
        steps.push('clearCloneId');
        return Promise.resolve();
      });
      mockUploadService.releaseRecorded.mockImplementation(() => {
        steps.push('release');
        return Promise.resolve(true);
      });
      mockVoiceRepository.softDeleteOwnedIfUnreferenced.mockImplementation(
        () => {
          steps.push('softDelete');
          return Promise.resolve(true);
        },
      );
    });

    const expectUntouched = () => {
      expect(mockUploadService.releaseRecorded).not.toHaveBeenCalled();
      expect(
        mockVoiceRepository.softDeleteOwnedIfUnreferenced,
      ).not.toHaveBeenCalled();
    };

    it("soft-deletes the voice, then frees its sample's storage", async () => {
      await service.deleteVoice('user-1', VOICE_ID);

      expect(
        mockVoiceRepository.softDeleteOwnedIfUnreferenced,
      ).toHaveBeenCalledWith(VOICE_ID, 'user-1');
      expect(mockUploadService.releaseRecorded).toHaveBeenCalledWith(
        'storytime/v',
        'user-1',
      );
      expect(steps).toEqual(['softDelete', 'release']);
    });

    it('soft-deletes a voice that has no recorded sample without touching storage', async () => {
      mockVoiceRepository.findByIdAndUser.mockResolvedValue(
        owned({ publicId: null }),
      );

      await service.deleteVoice('user-1', VOICE_ID);

      expect(steps).toEqual(['softDelete']);
    });

    it('answers not found for an unknown voice', async () => {
      await expect(
        service.deleteVoice('user-1', 'other-voice'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched();
    });

    it("answers not found for another user's voice", async () => {
      await expect(
        service.deleteVoice('user-2', VOICE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched();
    });

    it('refuses a voice that is still selected, keeping its sample', async () => {
      mockVoiceRepository.softDeleteOwnedIfUnreferenced.mockResolvedValue(
        false,
      );
      mockVoiceRepository.findFirstByIdNotDeleted.mockResolvedValue(owned());

      await expect(
        service.deleteVoice('user-1', VOICE_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockUploadService.releaseRecorded).not.toHaveBeenCalled();
    });

    it('reports the failure when freeing the sample fails', async () => {
      mockUploadService.releaseRecorded.mockRejectedValue(
        new Error('cdn down'),
      );

      await expect(service.deleteVoice('user-1', VOICE_ID)).rejects.toThrow(
        'cdn down',
      );
    });

    it('frees the sample on a retry after the voice was already deleted', async () => {
      mockVoiceRepository.findByIdAndUser.mockResolvedValue(
        owned({ isDeleted: true }),
      );

      await service.deleteVoice('user-1', VOICE_ID);

      expect(steps).toEqual(['release']);
    });

    it('answers not found for a deleted voice with nothing left to free', async () => {
      mockVoiceRepository.findByIdAndUser.mockResolvedValue(
        owned({ isDeleted: true }),
      );
      mockUploadService.releaseRecorded.mockResolvedValue(false);

      await expect(
        service.deleteVoice('user-1', VOICE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers not found for a deleted voice that never had a sample', async () => {
      mockVoiceRepository.findByIdAndUser.mockResolvedValue(
        owned({ isDeleted: true, publicId: null }),
      );

      await expect(
        service.deleteVoice('user-1', VOICE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched();
    });

    it('still frees the sample when a concurrent request deleted the voice first', async () => {
      mockVoiceRepository.softDeleteOwnedIfUnreferenced.mockResolvedValue(
        false,
      );

      await service.deleteVoice('user-1', VOICE_ID);

      expect(mockUploadService.releaseRecorded).toHaveBeenCalledWith(
        'storytime/v',
        'user-1',
      );
    });

    describe('ElevenLabs clone', () => {
      const CLONE_ID = 'clone-abc';
      const cloned = (over: Record<string, unknown> = {}) =>
        owned({ type: 'uploaded', elevenLabsVoiceId: CLONE_ID, ...over });

      beforeEach(() => {
        mockVoiceRepository.findByIdAndUser.mockResolvedValue(cloned());
      });

      const expectCloneUntouched = () => {
        expect(mockElevenLabsProvider.deleteVoice).not.toHaveBeenCalled();
        expect(
          mockVoiceRepository.clearElevenLabsVoiceId,
        ).not.toHaveBeenCalled();
      };

      it('deletes the clone made from the sample and forgets its id', async () => {
        await service.deleteVoice('user-1', VOICE_ID);

        expect(mockElevenLabsProvider.deleteVoice).toHaveBeenCalledWith(
          CLONE_ID,
        );
        expect(mockVoiceRepository.clearElevenLabsVoiceId).toHaveBeenCalledWith(
          VOICE_ID,
          'user-1',
        );
        expect(steps).toEqual([
          'softDelete',
          'release',
          'deleteClone',
          'clearCloneId',
        ]);
      });

      it('fails the delete and keeps the clone id when ElevenLabs fails', async () => {
        mockElevenLabsProvider.deleteVoice.mockRejectedValue(
          new Error('Status code: 500'),
        );

        await expect(
          service.deleteVoice('user-1', VOICE_ID),
        ).rejects.toBeInstanceOf(InternalServerErrorException);
        expect(
          mockVoiceRepository.clearElevenLabsVoiceId,
        ).not.toHaveBeenCalled();
      });

      it('does not echo the ElevenLabs error to the caller', async () => {
        mockElevenLabsProvider.deleteVoice.mockRejectedValue(
          new Error('Status code: 401 xi-api-key sk_secret'),
        );

        await expect(service.deleteVoice('user-1', VOICE_ID)).rejects.toThrow(
          'Voice deletion could not be completed. Please try again.',
        );
      });

      it('deletes the clone on a retry after the voice and sample are already gone', async () => {
        mockVoiceRepository.findByIdAndUser.mockResolvedValue(
          cloned({ isDeleted: true }),
        );
        mockUploadService.releaseRecorded.mockResolvedValue(false);

        await service.deleteVoice('user-1', VOICE_ID);

        expect(mockElevenLabsProvider.deleteVoice).toHaveBeenCalledWith(
          CLONE_ID,
        );
        expect(mockVoiceRepository.clearElevenLabsVoiceId).toHaveBeenCalledWith(
          VOICE_ID,
          'user-1',
        );
      });

      it('answers not found once the voice, sample and clone are all gone', async () => {
        mockVoiceRepository.findByIdAndUser.mockResolvedValue(
          cloned({ isDeleted: true, elevenLabsVoiceId: null }),
        );
        mockUploadService.releaseRecorded.mockResolvedValue(false);

        await expect(
          service.deleteVoice('user-1', VOICE_ID),
        ).rejects.toBeInstanceOf(NotFoundException);
        expectCloneUntouched();
      });

      it('keeps the clone when the voice is still selected', async () => {
        mockVoiceRepository.softDeleteOwnedIfUnreferenced.mockResolvedValue(
          false,
        );
        mockVoiceRepository.findFirstByIdNotDeleted.mockResolvedValue(cloned());

        await expect(
          service.deleteVoice('user-1', VOICE_ID),
        ).rejects.toBeInstanceOf(ConflictException);
        expectCloneUntouched();
      });

      it('never deletes an ElevenLabs voice the user only registered', async () => {
        mockVoiceRepository.findByIdAndUser.mockResolvedValue(
          cloned({ type: 'elevenlabs', publicId: null }),
        );

        await service.deleteVoice('user-1', VOICE_ID);

        expect(steps).toEqual(['softDelete']);
      });

      it('never deletes an ElevenLabs id that belongs to a system voice row', async () => {
        mockVoiceRepository.findSystemVoiceIdByElevenLabsId.mockImplementation(
          (id: string) =>
            Promise.resolve(id === CLONE_ID ? { id: 'system-voice' } : null),
        );

        await service.deleteVoice('user-1', VOICE_ID);

        expect(steps).toEqual(['softDelete', 'release']);
      });

      it('never deletes an ElevenLabs id of a built-in voice', async () => {
        mockVoiceRepository.findByIdAndUser.mockResolvedValue(
          cloned({
            elevenLabsVoiceId: VOICE_CONFIG[VoiceType.MILO].elevenLabsId,
          }),
        );

        await service.deleteVoice('user-1', VOICE_ID);

        expect(steps).toEqual(['softDelete', 'release']);
      });
    });
  });
});
