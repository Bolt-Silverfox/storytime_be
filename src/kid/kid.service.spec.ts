import { Test, TestingModule } from '@nestjs/testing';
import { KidService } from './kid.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { VoiceService } from '../voice/voice.service';
import { VoiceType } from '@/story/story.dto';
import { AgeService } from '../age/age.service';

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
};

const mockVoiceService = {
    findOrCreateElevenLabsVoice: jest.fn(),
};

const mockAgeService = {
    findGroupForAge: jest.fn(),
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
                { provide: AgeService, useValue: mockAgeService },
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
            const expectedResult = { id: 'kid-1', ...dto, parentId: userId, ageGroup: null };

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
            const expectedResult = [{ id: 'kid-1', parentId: userId, ageGroup: null }];

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
            const expectedResult = { id: kidId, parentId: userId, ageGroup: null };

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
            const updatedKid = { ...existingKid, ...dto, ageGroup: null };

            prisma.kid.findUnique.mockResolvedValue(existingKid);
            prisma.kid.update.mockResolvedValue(updatedKid);

            const result = await service.updateKid(kidId, userId, dto);
            expect(result).toEqual(updatedKid);
        });

        it('should throw NotFoundException if kid not found or access denied', async () => {
            prisma.kid.findUnique.mockResolvedValue(null);
            await expect(service.updateKid('kid-1', 'user-1', {})).rejects.toThrow(NotFoundException);
        });

        it('should throw NotFoundException if preferredVoiceId is invalid', async () => {
            const kidId = 'kid-1';
            const userId = 'user-1';
            // Use a valid UUID that doesn't exist to trigger the UUID check path
            const dto = { preferredVoiceId: '00000000-0000-0000-0000-000000000000' };
            const existingKid = { id: kidId, parentId: userId };

            prisma.kid.findUnique.mockResolvedValue(existingKid);
            prisma.voice.findUnique.mockResolvedValue(null);

            await expect(service.updateKid(kidId, userId, dto)).rejects.toThrow(NotFoundException);
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


    describe('createKids', () => {
        it('should create multiple kids in a transaction', async () => {
            const userId = 'user-1';
            const dtos = [
                { name: 'Kid 1', ageRange: '5-8', avatarId: 'avatar-1' },
                { name: 'Kid 2', ageRange: '9-12', avatarId: 'avatar-2' },
            ];
            const dbKids = [
                { id: 'kid-1', ...dtos[0], parentId: userId, preferredVoiceId: null },
                { id: 'kid-2', ...dtos[1], parentId: userId, preferredVoiceId: null },
            ];
            const expectedResult = dbKids.map(k => ({ ...k, ageGroup: null }));

            // Mock prisma.$transaction
            (prisma as any).$transaction = jest.fn().mockResolvedValue(dbKids);

            // Mock parent user check
            prisma.user.findUnique.mockResolvedValue({ id: userId } as any);

            // Mock kid.create
            prisma.kid.create.mockReturnValue('mock-prisma-promise' as any);

            // Mock findMany called by findAllByUser
            prisma.kid.findMany.mockResolvedValue(dbKids);

            const result = await service.createKids(userId, dtos);

            expect(result).toEqual(expectedResult);
            expect(prisma.kid.create).toHaveBeenCalledTimes(2);
            expect(prisma.kid.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    name: dtos[0].name,
                    parentId: userId,
                    avatarId: dtos[0].avatarId,
                }),
            }));
            expect(prisma.kid.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    name: dtos[1].name,
                    parentId: userId,
                    avatarId: dtos[1].avatarId,
                }),
            }));
            expect((prisma as any).$transaction).toHaveBeenCalled();
        });
    });
});
