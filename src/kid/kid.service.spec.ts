import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { KidService } from './kid.service';
import { KID_REPOSITORY } from './repositories/kid.repository.interface';
import { VoiceService } from '../voice/voice.service';

const mockKidRepository = {
  create: jest.fn(),
  createMany: jest.fn(),
  findAllByParentId: jest.fn(),
  findById: jest.fn(),
  findByIdNotDeleted: jest.fn(),
  findByIdWithFullRelations: jest.fn(),
  findUserByIdNotDeleted: jest.fn(),
  findVoiceById: jest.fn(),
  countParentRecommendations: jest.fn().mockResolvedValue(0),
  update: jest.fn(),
  softDelete: jest.fn(),
  hardDelete: jest.fn(),
  restore: jest.fn(),
};

const mockVoiceService = {
  findOrCreateElevenLabsVoice: jest.fn(),
};

const mockCacheManager = {
  get: jest.fn().mockResolvedValue(null),
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
    mockCacheManager.get.mockResolvedValue(null);
    repo.countParentRecommendations.mockResolvedValue(0);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createKid', () => {
    it('should create a kid', async () => {
      const dto = { name: 'Alex', ageRange: '5-8', avatarId: 'avatar-1' };
      const userId = 'user-1';
      const created = { id: 'kid-1', ...dto, parentId: userId };

      repo.create.mockResolvedValue(created);

      const result = await service.createKid(userId, dto);
      expect(result).toEqual({ ...created, preferredVoiceId: undefined });
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
    it('should return array of kids from the repository', async () => {
      const userId = 'user-1';
      const kids = [{ id: 'kid-1', parentId: userId, preferredVoiceId: null }];

      repo.findAllByParentId.mockResolvedValue(kids);

      const result = await service.findAllByUser(userId);
      expect(result).toEqual(kids);
      expect(repo.findAllByParentId).toHaveBeenCalledWith(userId);
    });

    it('should return cached kids when present', async () => {
      const cached = [{ id: 'kid-cached' }];
      mockCacheManager.get.mockResolvedValue(cached);

      const result = await service.findAllByUser('user-1');
      expect(result).toEqual(cached);
      expect(repo.findAllByParentId).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a kid if found and owned by user', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const mockKid = { id: kidId, parentId: userId };

      repo.findByIdWithFullRelations.mockResolvedValue(mockKid);

      const result = await service.findOne(kidId, userId);
      expect(result).toStrictEqual({
        ...mockKid,
        preferredVoiceId: undefined,
        recommendationStats: {
          total: 0,
        },
      });
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
      const updatedKid = { ...existingKid, ...dto, preferredVoiceId: null };

      repo.findByIdNotDeleted.mockResolvedValue(existingKid);
      repo.update.mockResolvedValue(updatedKid);

      const result = await service.updateKid(kidId, userId, dto);
      expect(result).toEqual(updatedKid);
    });

    it('should throw NotFoundException if kid not found or access denied', async () => {
      repo.findByIdNotDeleted.mockResolvedValue(null);
      await expect(service.updateKid('kid-1', 'user-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if preferredVoiceId (UUID) is invalid', async () => {
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
    it('should soft-delete a kid', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const existingKid = { id: kidId, parentId: userId };
      const softDeleted = { ...existingKid, isDeleted: true };

      repo.findByIdNotDeleted.mockResolvedValue(existingKid);
      repo.softDelete.mockResolvedValue(softDeleted);

      const result = await service.deleteKid(kidId, userId);
      expect(result).toEqual(softDeleted);
      expect(repo.softDelete).toHaveBeenCalledWith(kidId);
    });

    it('should hard-delete when permanent is true', async () => {
      const kidId = 'kid-1';
      const userId = 'user-1';
      const existingKid = { id: kidId, parentId: userId };

      repo.findByIdNotDeleted.mockResolvedValue(existingKid);
      repo.hardDelete.mockResolvedValue({ id: kidId });

      await service.deleteKid(kidId, userId, true);
      expect(repo.hardDelete).toHaveBeenCalledWith(kidId);
    });
  });

  describe('createKids', () => {
    it('should create multiple kids and return the user list', async () => {
      const userId = 'user-1';
      const dtos = [
        { name: 'Kid 1', ageRange: '5-8', avatarId: 'avatar-1' },
        { name: 'Kid 2', ageRange: '9-12', avatarId: 'avatar-2' },
      ];
      const dbKids = [
        { id: 'kid-1', ...dtos[0], parentId: userId, preferredVoiceId: null },
        { id: 'kid-2', ...dtos[1], parentId: userId, preferredVoiceId: null },
      ];

      repo.findUserByIdNotDeleted.mockResolvedValue({ id: userId });
      repo.createMany.mockResolvedValue(dbKids);
      repo.findAllByParentId.mockResolvedValue(dbKids);

      const result = await service.createKids(userId, dtos);

      expect(result).toEqual(dbKids);
      expect(repo.createMany).toHaveBeenCalledWith(
        userId,
        expect.arrayContaining([
          expect.objectContaining({ name: dtos[0].name, parentId: userId }),
          expect.objectContaining({ name: dtos[1].name, parentId: userId }),
        ]),
      );
    });

    it('should throw NotFoundException when parent is missing', async () => {
      repo.findUserByIdNotDeleted.mockResolvedValue(null);
      await expect(service.createKids('user-1', [])).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
