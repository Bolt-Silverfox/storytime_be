import { Test, TestingModule } from '@nestjs/testing';
import { KidService } from './kid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { VoiceType } from '@/story/story.dto';

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
};

describe('KidService', () => {
    let service: KidService;
    let prisma: typeof mockPrismaService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                KidService,
                { provide: PrismaService, useValue: mockPrismaService },
            ],
        }).compile();

        service = module.get<KidService>(KidService);
        prisma = module.get(PrismaService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('createKid', () => {
        it('should create a kid', async () => {
            const dto = { name: 'Alex', ageRange: '5-8', avatarId: 'avatar-1' };
            const userId = 'user-1';
            const expectedResult = { id: 'kid-1', ...dto, parentId: userId };

            prisma.kid.create.mockResolvedValue(expectedResult);

            const result = await service.createKid(userId, dto);
            expect(result).toEqual(expectedResult);
            expect(prisma.kid.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    name: dto.name,
                    parentId: userId,
                    avatarId: dto.avatarId,
                }),
            }));
        });
    });

    describe('findAllByUser', () => {
        it('should return array of kids', async () => {
            const userId = 'user-1';
            const expectedResult = [{ id: 'kid-1', parentId: userId }];

            prisma.kid.findMany.mockResolvedValue(expectedResult);

            const result = await service.findAllByUser(userId);
            expect(result).toEqual(expectedResult);
            expect(prisma.kid.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { parentId: userId },
            }));
        });
    });

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
            await expect(service.findOne('kid-1', 'user-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException if kid belongs to another user', async () => {
            prisma.kid.findUnique.mockResolvedValue({ id: 'kid-1', parentId: 'other-user' });
            await expect(service.findOne('kid-1', 'user-1')).rejects.toThrow(ForbiddenException);
        });
    });

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

        it('should throw NotFoundException if kid not found or access denied', async () => {
            prisma.kid.findUnique.mockResolvedValue(null);
            await expect(service.updateKid('kid-1', 'user-1', {})).rejects.toThrow(NotFoundException);
        });
    });

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

    describe('setKidPreferredVoice', () => {
        it('should set preferred voice', async () => {
            const kidId = 'kid-1';
            const voiceType = VoiceType.MILO;
            const voice = { id: 'voice-1', name: 'MILO' };
            const updatedKid = { id: kidId, preferredVoiceId: voice.id };

            prisma.voice.findFirst.mockResolvedValue(voice);
            prisma.kid.update.mockResolvedValue(updatedKid);

            const result = await service.setKidPreferredVoice(kidId, voiceType);
            expect(result).toEqual({
                kidId,
                voiceType,
                preferredVoiceId: voice.id,
            });
        });

        it('should throw NotFoundException if voice not found', async () => {
            prisma.voice.findFirst.mockResolvedValue(null);
            await expect(service.setKidPreferredVoice('kid-1', VoiceType.MILO)).rejects.toThrow(NotFoundException);
        });
    });

    describe('getKidPreferredVoice', () => {
        it('should return preferred voice', async () => {
            const kidId = 'kid-1';
            const voiceId = 'voice-1';
            const kid = { id: kidId, preferredVoiceId: voiceId };
            const voice = { id: voiceId, name: 'MILO' };

            prisma.kid.findUnique.mockResolvedValue(kid);
            prisma.voice.findUnique.mockResolvedValue(voice);

            const result = await service.getKidPreferredVoice(kidId);
            expect(result).toEqual({
                kidId,
                voiceType: VoiceType.MILO,
                preferredVoiceId: voiceId,
            });
        });

        it('should return default voice if no preference set', async () => {
            const kidId = 'kid-1';
            const kid = { id: kidId, preferredVoiceId: null };

            prisma.kid.findUnique.mockResolvedValue(kid);

            const result = await service.getKidPreferredVoice(kidId);
            expect(result).toEqual({
                kidId,
                voiceType: VoiceType.MILO,
                preferredVoiceId: '',
            });
        });
    });
});
