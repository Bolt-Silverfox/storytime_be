import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from './voice.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { ElevenLabsTTSProvider } from './providers/eleven-labs-tts.provider';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockPrismaService = {
  voice: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  user: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
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

describe('VoiceService', () => {
  let service: VoiceService;
  let prisma: typeof mockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ElevenLabsTTSProvider, useValue: mockElevenLabsProvider },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listVoices', () => {
    it('should return all voices for a user', async () => {
      const userId = 'user-1';
      const userVoices = [
        {
          id: 'voice-1',
          name: 'Custom Voice',
          type: 'uploaded',
          url: 'http://url',
          elevenLabsVoiceId: null,
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      prisma.voice.findMany.mockResolvedValue(userVoices);

      const result = await service.listVoices(userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'voice-1',
        name: 'Custom Voice',
      });

      expect(prisma.voice.findMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });
  });
});
