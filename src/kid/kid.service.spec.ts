import { Test, TestingModule } from '@nestjs/testing';
import { KidService } from './kid.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { VoiceService } from '../voice/voice.service';
import { KID_REPOSITORY } from './repositories';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';

const mockKidRepository = {
  create: jest.fn(),
  findById: jest.fn(),
  findByIdNotDeleted: jest.fn(),
  findByIdWithRelations: jest.fn(),
  findByIdWithFullRelations: jest.fn(),
  findAllByParentId: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  restore: jest.fn(),
  hardDelete: jest.fn(),
  createMany: jest.fn(),
  countParentRecommendations: jest.fn(),
  findVoiceById: jest.fn(),
  findUserByIdNotDeleted: jest.fn(),
};

const mockVoiceService = {
  findOrCreateElevenLabsVoice: jest.fn(),
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('KidService', () => {
  let service: KidService;
  let repo: typeof mockKidRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KidService,
        { provide: KID_REPOSITORY, useValue: mockKidRepository },
        { provide: VoiceService, useValue: mockVoiceService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<KidService>(KidService);
    repo = module.get(KID_REPOSITORY);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createKid', () => {
    it('should create a kid', async () => {
      const dto = { name: 'Alex', ageRange: '5-8', avatarId: 'avatar-1' };
      const userId = 'user-1';
      const expectedResult = {
        id: 'kid-1',
        ...dto,
        parentId: userId,
        createdAt: new Date(),
        preferredVoiceId: null,
        preferredVoice: null,
      };

      repo.create.mockResolvedValue(expectedResult);

      const result = await service.createKid(userId, dto);
      expect(result).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: dto.name,
          parentId: userId,
          avatarId: dto.avatarId,
        }),
      );
    });
  });

  describe('findAllByUser', () => {
    it('should return array of kids', async () => {
      const userId = 'user-1';
      const expectedResult = [
        {
          id: 'kid-1',
          parentId: userId,
          preferredVoiceId: null,
          preferredVoice: null,
        },
      ];

      mockCacheManager.get.mockResolvedValue(null);
      repo.findAllByParentId.mockResolvedValue(expectedResult);

      const result = await service.findAllByUser(userId);
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(repo.findAllByParentId).toHaveBeenCalledWith(userId);
    });

    it('should return cached result if available', async () => {
      const userId = 'user-1';
      const cachedResult = [{ id: 'kid-1', parentId: userId }];

      mockCacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.findAllByUser(userId);
      expect(result).toEqual(cachedResult);
      expect(repo.findAllByParentId).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a kid if found and owned by user', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const expectedResult = {
        id: kidId,
        parentId: userId,
        preferredVoiceId: null,
        preferredVoice: null,
      };

      repo.findByIdWithFullRelations.mockResolvedValue(expectedResult);
      repo.countParentRecommendations.mockResolvedValue(0);

      const result = await service.findOne(kidId, userId);
      expect(result).toBeDefined();
      expect(result.id).toBe(kidId);
    });

    it('should throw NotFoundException if kid not found', async () => {
      repo.findByIdWithFullRelations.mockResolvedValue(null);
      await expect(service.findOne('kid-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if kid belongs to another user', async () => {
      repo.findByIdWithFullRelations.mockResolvedValue({
        id: 'kid-1',
        parentId: 'other-user',
      });
      await expect(service.findOne('kid-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateKid', () => {
    it('should update a kid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const dto = { name: 'Alex Updated' };
      const existingKid = { id: kidId, parentId: userId };
      const updatedKid = {
        ...existingKid,
        ...dto,
        preferredVoiceId: null,
        preferredVoice: null,
      };

      repo.findByIdNotDeleted.mockResolvedValue(existingKid);
      repo.update.mockResolvedValue(updatedKid);

      const result = await service.updateKid(kidId, userId, dto);
      expect(result).toBeDefined();
      expect(result!.name).toBe('Alex Updated');
    });

    it('should throw NotFoundException if kid not found or access denied', async () => {
      repo.findByIdNotDeleted.mockResolvedValue(null);
      await expect(service.updateKid('kid-1', 'user-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if preferredVoiceId is invalid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const dto = { preferredVoiceId: '00000000-0000-0000-0000-000000000000' };
      const existingKid = { id: kidId, parentId: userId };

      repo.findByIdNotDeleted.mockResolvedValue(existingKid);
      repo.findVoiceById.mockResolvedValue(null);

      await expect(service.updateKid(kidId, userId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteKid', () => {
    it('should soft delete a kid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const existingKid = { id: kidId, parentId: userId };

      repo.findByIdNotDeleted.mockResolvedValue(existingKid);
      const softDeletedKid = {
        ...existingKid,
        isDeleted: true,
        deletedAt: new Date(),
      };
      repo.softDelete.mockResolvedValue(softDeletedKid);

      const result = await service.deleteKid(kidId, userId);
      expect(result).toEqual(softDeletedKid);
      expect(repo.softDelete).toHaveBeenCalledWith(kidId);
    });
  });

  describe('createKids', () => {
    it('should create multiple kids', async () => {
      const userId = 'user-1';
      const dtos = [
        { name: 'Kid 1', ageRange: '5-8', avatarId: 'avatar-1' },
        { name: 'Kid 2', ageRange: '9-12', avatarId: 'avatar-2' },
      ];
      const dbKids = [
        {
          id: 'kid-1',
          ...dtos[0],
          parentId: userId,
          preferredVoiceId: null,
          preferredVoice: null,
        },
        {
          id: 'kid-2',
          ...dtos[1],
          parentId: userId,
          preferredVoiceId: null,
          preferredVoice: null,
        },
      ];

      repo.findUserByIdNotDeleted.mockResolvedValue({ id: userId });
      repo.createMany.mockResolvedValue(undefined);
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.del.mockResolvedValue(undefined);
      repo.findAllByParentId.mockResolvedValue(dbKids);

      const result = await service.createKids(userId, dtos);

      expect(result).toHaveLength(2);
      expect(repo.createMany).toHaveBeenCalled();
      expect(repo.findUserByIdNotDeleted).toHaveBeenCalledWith(userId);
    });
  });
});
