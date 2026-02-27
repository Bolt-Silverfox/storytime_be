import { Test, TestingModule } from '@nestjs/testing';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { StoryQuotaService } from './story-quota.service';
import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Mock the Service so we test the Controller in isolation
const mockStoryQuotaService = {
  recordNewStoryAccess: jest.fn(),
};

const mockStoryService = {
  generateStoryForKid: jest.fn(),
  getCreatedStories: jest.fn(),
  getDownloads: jest.fn(),
  addDownload: jest.fn(),
  removeDownload: jest.fn(),
  removeFromLibrary: jest.fn(),
  getTopPicksFromParents: jest.fn(),
  updateStory: jest.fn(),
};

const mockPrismaService = {
  kid: {
    findFirst: jest
      .fn()
      .mockResolvedValue({ id: 'kid-123', parentId: 'user-1' }),
  },
  story: {
    findFirst: jest.fn(),
  },
};

const mockReq = {
  authUserData: { userId: 'user-1' },
} as any;

describe('StoryController', () => {
  let controller: StoryController;
  let service: typeof mockStoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoryController],
      providers: [
        { provide: StoryService, useValue: mockStoryService },
        { provide: StoryQuotaService, useValue: mockStoryQuotaService },
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: 'CACHE_MANAGER',
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    })
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      .overrideGuard(require('../shared/guards/auth.guard').AuthSessionGuard) // Bypass Auth Guard
      .useValue({ canActivate: () => true })
      .overrideGuard(SubscriptionThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StoryController>(StoryController);
    service = module.get(StoryService);
    jest.clearAllMocks();
    mockPrismaService.kid.findFirst.mockResolvedValue({
      id: 'kid-123',
      parentId: 'user-1',
    });
  });

  // --- 1. TEST THE GENERATION ENDPOINT ---
  describe('generateStoryForKid', () => {
    it('should call service with correct kidId and arrays for theme/category', async () => {
      const kidId = 'kid-123';
      const theme = 'Space';
      const category = 'Adventure';

      await controller.generateStoryForKid(mockReq, kidId, theme, category);

      // Verify the controller converts single strings to arrays for the service
      expect(service.generateStoryForKid).toHaveBeenCalledWith(
        kidId,
        ['Space'],
        ['Adventure'],
      );
    });

    it('should handle missing theme/category params', async () => {
      const kidId = 'kid-123';
      await controller.generateStoryForKid(mockReq, kidId);

      expect(service.generateStoryForKid).toHaveBeenCalledWith(
        kidId,
        undefined,
        undefined,
      );
    });
  });

  // --- 2. TEST LIBRARY ENDPOINTS ---
  describe('Library Features', () => {
    const kidId = 'kid-123';
    const storyId = 'story-456';

    it('getCreated: should call getCreatedStories service method', async () => {
      await controller.getCreated(mockReq, kidId);
      expect(service.getCreatedStories).toHaveBeenCalledWith(
        kidId,
        undefined,
        undefined,
      );
    });

    it('getDownloads: should call getDownloads service method', async () => {
      await controller.getDownloads(mockReq, kidId);
      expect(service.getDownloads).toHaveBeenCalledWith(
        kidId,
        undefined,
        undefined,
      );
    });

    it('getCreated: should pass sanitized cursor and limit to service', async () => {
      await controller.getCreated(mockReq, kidId, 'abc', '10');
      expect(service.getCreatedStories).toHaveBeenCalledWith(kidId, 'abc', 10);
    });

    it('getCreated: should default limit when not provided with cursor', async () => {
      await controller.getCreated(mockReq, kidId, 'abc');
      expect(service.getCreatedStories).toHaveBeenCalledWith(kidId, 'abc', 20);
    });

    it('getDownloads: should pass sanitized cursor and limit to service', async () => {
      await controller.getDownloads(mockReq, kidId, 'xyz', '5');
      expect(service.getDownloads).toHaveBeenCalledWith(kidId, 'xyz', 5);
    });

    it('getDownloads: should default limit when not provided with cursor', async () => {
      await controller.getDownloads(mockReq, kidId, 'xyz');
      expect(service.getDownloads).toHaveBeenCalledWith(kidId, 'xyz', 20);
    });

    it('addDownload: should call addDownload service method', async () => {
      await controller.addDownload(mockReq, kidId, storyId);
      expect(service.addDownload).toHaveBeenCalledWith(kidId, storyId);
    });

    it('removeFromLibrary: should call removeFromLibrary service method', async () => {
      await controller.removeFromLibrary(mockReq, kidId, storyId);
      expect(service.removeFromLibrary).toHaveBeenCalledWith(kidId, storyId);
    });
  });

  // --- 3. TOP PICKS ENDPOINT ---
  describe('getTopPicksFromParents', () => {
    it('should call service with capped limit of 50 when exceeding max', async () => {
      await controller.getTopPicksFromParents(100);
      expect(service.getTopPicksFromParents).toHaveBeenCalledWith(50);
    });

    it('should call service with provided limit when within bounds', async () => {
      await controller.getTopPicksFromParents(25);
      expect(service.getTopPicksFromParents).toHaveBeenCalledWith(25);
    });

    it('should use default limit of 10', async () => {
      await controller.getTopPicksFromParents(10);
      expect(service.getTopPicksFromParents).toHaveBeenCalledWith(10);
    });

    it('should return the result from the service', async () => {
      const mockResult = [
        { id: 'story-1', title: 'Top Story', recommendationCount: 5 },
      ];
      service.getTopPicksFromParents.mockResolvedValue(mockResult);

      const result = await controller.getTopPicksFromParents(10);

      expect(result).toEqual(mockResult);
    });
  });

  // --- 4. IDOR PROTECTION ---
  describe('IDOR protection', () => {
    it('should throw NotFoundException when kid does not belong to parent', async () => {
      mockPrismaService.kid.findFirst.mockResolvedValue(null);
      await expect(controller.getCreated(mockReq, 'kid-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when story does not exist', async () => {
      mockPrismaService.story.findFirst.mockResolvedValue(null);
      await expect(
        controller.updateStory(mockReq, 'non-existent-story', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when story belongs to another user', async () => {
      mockPrismaService.story.findFirst.mockResolvedValue({
        id: 'story-123',
        isDeleted: false,
        creatorKidId: 'other-kid',
        creatorKid: { parentId: 'other-user' },
      });
      await expect(
        controller.updateStory(mockReq, 'story-123', {} as any),
      ).rejects.toThrow(ForbiddenException);
      expect(mockStoryService.updateStory).not.toHaveBeenCalled();
    });
  });
});
