import { Test, TestingModule } from '@nestjs/testing';
import { KidService } from './kid.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceService } from '../voice/voice.service';
import { VoiceType, VOICEID } from '@/story/story.dto';

const mockPrismaService = {
  kid: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  voice: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockVoiceService = {
  findOrCreateElevenLabsVoice: jest.fn(),
};

describe('KidService', () => {
  let service: KidService;
  let prisma: typeof mockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KidService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: VoiceService, useValue: mockVoiceService },
      ],
    }).compile();

    service = module.get<KidService>(KidService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------
  // CREATE KID
  // -------------------------------
  describe('createKid', () => {
    it('should create a kid', async () => {
      const dto = { name: 'Alex', ageRange: '5-8', avatarId: 'avatar-1' };
      const userId = 'user-1';
      const expectedResult = { id: 'kid-1', ...dto, parentId: userId };

      prisma.kid.create.mockResolvedValue(expectedResult);

      const result = await service.createKid(userId, dto);

      expect(result).toEqual(expectedResult);
      expect(prisma.kid.create).toHaveBeenCalled();
    });
  });

  // -------------------------------
  // FIND ALL
  // -------------------------------
  describe('findAllByUser', () => {
    it('should return array of kids', async () => {
      const userId = 'user-1';
      const expectedResult = [{ id: 'kid-1', parentId: userId }];

      prisma.kid.findMany.mockResolvedValue(expectedResult);

      const result = await service.findAllByUser(userId);

      expect(result).toEqual(expectedResult);
      expect(prisma.kid.findMany).toHaveBeenCalledWith({
        where: { parentId: userId },
      });
    });
  });

  // -------------------------------
  // FIND ONE
  // -------------------------------
  describe('findOne', () => {
    it('should return a kid if found and owned by user', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const expectedResult = { id: kidId, parentId: userId };

      prisma.kid.findUnique.mockResolvedValue(expectedResult);

      const result = await service.findOne(kidId, userId);
      expect(result).toEqual(expectedResult);
    });

    it('should throw NotFoundException if kid not found', async () => {
      prisma.kid.findUnique.mockResolvedValue(null);
      await expect(
        service.findOne('kid-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if kid belongs to another user', async () => {
      prisma.kid.findUnique.mockResolvedValue({
        id: 'kid-1',
        parentId: 'other-user',
      });

      await expect(
        service.findOne('kid-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // -------------------------------
  // UPDATE KID
  // -------------------------------
  describe('updateKid', () => {
    it('should update a kid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const dto = { name: 'Alex Updated' };
      const existingKid = { id: kidId, parentId: userId };
      const updatedKid = { ...existingKid, ...dto };

      prisma.kid.findUnique.mockResolvedValue(existingKid);
      prisma.kid.update.mockResolvedValue(updatedKid);

      const result = await service.updateKid(kidId, userId, dto);

      expect(result).toEqual(updatedKid);
    });

    it('should throw NotFoundException if kid not found', async () => {
      prisma.kid.findUnique.mockResolvedValue(null);

      await expect(
        service.updateKid('kid-1', 'user-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if preferredVoiceId is invalid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const dto = { preferredVoiceId: '00000000-0000-0000-0000-000000000000' };

      prisma.kid.findUnique.mockResolvedValue({ id: kidId, parentId: userId });
      prisma.voice.findUnique.mockResolvedValue(null);

      await expect(
        service.updateKid(kidId, userId, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------
  // DELETE KID
  // -------------------------------
  describe('deleteKid', () => {
    it('should delete a kid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';

      const existingKid = { id: kidId, parentId: userId };

      prisma.kid.findUnique.mockResolvedValue(existingKid);
      prisma.kid.delete.mockResolvedValue(existingKid);

      const result = await service.deleteKid(kidId, userId);

      expect(result).toEqual(existingKid);
    });
  });

  // -------------------------------
  // SET PREFERRED VOICE
  // -------------------------------
  describe('setKidPreferredVoice', () => {
    it('should update preferred voice', async () => {
      const kidId = 'kid-1';
      const voiceType: VoiceType = 'MALE';
      const voiceId = VOICEID[voiceType];

      prisma.kid.findUnique.mockResolvedValue({ id: kidId });
      prisma.kid.update.mockResolvedValue({
        id: kidId,
        preferredVoiceId: voiceId,
        preferredVoice: { name: 'Male Voice' },
      });

      const result = await service.setKidPreferredVoice(kidId, voiceType);

      expect(result.voiceId).toBe(voiceId);
    });
  });

  // -------------------------------
  // GET PREFERRED VOICE
  // -------------------------------
  describe('getKidPreferredVoice', () => {
    it('should return voice info', async () => {
      const kidId = 'kid-1';

      prisma.kid.findUnique.mockResolvedValue({
        id: kidId,
        preferredVoiceId: 'voice-123',
        preferredVoice: { name: 'Lovely Voice' },
      });

      const result = await service.getKidPreferredVoice(kidId);

      expect(result.voiceName).toBe('Lovely Voice');
    });
  });
});
