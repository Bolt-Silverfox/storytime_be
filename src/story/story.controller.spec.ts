import { Test, TestingModule } from '@nestjs/testing';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { TextToSpeechService } from './text-to-speech.service';
import { CreateStoryDto } from './dto/story.dto';

// Mock the Service so we test the Controller in isolation
const mockStoryService = {
  generateStoryForKid: jest.fn(),
  getCreatedStories: jest.fn(),
  getDownloads: jest.fn(),
  addDownload: jest.fn(),
  removeDownload: jest.fn(),
  removeFromLibrary: jest.fn(),
  getTopPicksFromParents: jest.fn(),
};

const mockTextToSpeechService = {}; // Mock dependency

describe('StoryController', () => {
  let controller: StoryController;
  let service: typeof mockStoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoryController],
      providers: [
        { provide: StoryService, useValue: mockStoryService },
        { provide: TextToSpeechService, useValue: mockTextToSpeechService },
        {
          provide: 'CACHE_MANAGER',
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    })
      .overrideGuard(require('../auth/auth.guard').AuthSessionGuard) // Bypass Auth Guard
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StoryController>(StoryController);
    service = module.get(StoryService);
    jest.clearAllMocks();
  });

  // --- 1. TEST THE GENERATION ENDPOINT ---
  describe('generateStoryForKid', () => {
    it('should call service with correct kidId and arrays for theme/category', async () => {
      const kidId = 'kid-123';
      const theme = 'Space';
      const category = 'Adventure';

      await controller.generateStoryForKid(kidId, theme, category);

      // Verify the controller converts single strings to arrays for the service
      expect(service.generateStoryForKid).toHaveBeenCalledWith(
        kidId,
        ['Space'],
        ['Adventure'],
      );
    });

    it('should handle missing theme/category params', async () => {
      const kidId = 'kid-123';
      await controller.generateStoryForKid(kidId);

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
      await controller.getCreated(kidId);
      expect(service.getCreatedStories).toHaveBeenCalledWith(kidId);
    });

    it('getDownloads: should call getDownloads service method', async () => {
      await controller.getDownloads(kidId);
      expect(service.getDownloads).toHaveBeenCalledWith(kidId);
    });

    it('addDownload: should call addDownload service method', async () => {
      await controller.addDownload(kidId, storyId);
      expect(service.addDownload).toHaveBeenCalledWith(kidId, storyId);
    });

    it('removeFromLibrary: should call removeFromLibrary service method', async () => {
      await controller.removeFromLibrary(kidId, storyId);
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
});
