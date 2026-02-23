import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  TextToSpeechService,
  preprocessTextForTTS,
} from './text-to-speech.service';
import { UploadService } from '../upload/upload.service';
import { VoiceType } from '../voice/dto/voice.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { StyleTTS2TTSProvider } from '../voice/providers/styletts2-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { MAX_TTS_TEXT_LENGTH } from '../voice/voice.config';

describe('TextToSpeechService', () => {
  let service: TextToSpeechService;

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockStyleTts2Generate = jest.fn();
  const mockEdgeTtsGenerate = jest.fn();
  const mockIsPremiumUser = jest.fn();
  const mockCheckUsage = jest.fn();
  const mockIncrementUsage = jest.fn();

  const mockPrisma = {
    paragraphAudioCache: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    voice: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset mock implementations (clearAllMocks only resets calls, not implementations)
    mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue(null);
    mockPrisma.paragraphAudioCache.upsert.mockResolvedValue({});
    mockPrisma.voice.findUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TextToSpeechService,
        {
          provide: UploadService,
          useValue: {
            uploadAudioBuffer: mockUploadAudio,
          },
        },
        {
          provide: ElevenLabsTTSProvider,
          useValue: {
            generateAudio: mockElevenLabsGenerate,
          },
        },
        {
          provide: StyleTTS2TTSProvider,
          useValue: {
            generateAudio: mockStyleTts2Generate,
          },
        },
        {
          provide: EdgeTTSProvider,
          useValue: {
            generateAudio: mockEdgeTtsGenerate,
          },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: VoiceQuotaService,
          useValue: {
            checkUsage: mockCheckUsage,
            incrementUsage: mockIncrementUsage,
          },
        },
        {
          provide: SubscriptionService,
          useValue: {
            isPremiumUser: mockIsPremiumUser,
          },
        },
      ],
    }).compile();

    service = module.get<TextToSpeechService>(TextToSpeechService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('preprocessTextForTTS', () => {
    it('should strip double quotes', () => {
      expect(preprocessTextForTTS('"Hello" world')).toBe('Hello world');
    });

    it('should strip curly double quotes', () => {
      expect(preprocessTextForTTS('\u201CHello\u201D')).toBe('Hello');
    });

    it('should preserve contractions', () => {
      expect(preprocessTextForTTS("don't it's I'm")).toBe("don't it's I'm");
    });

    it('should strip standalone single quotes', () => {
      expect(preprocessTextForTTS("'Hello' world")).toBe('Hello world');
    });

    it('should collapse whitespace and trim', () => {
      expect(preprocessTextForTTS('  hello   world  ')).toBe('hello world');
    });
  });

  describe('textToSpeechCloudUrl', () => {
    const storyId = 'story-123';
    const text = 'Once upon a time';
    const voiceType = VoiceType.CHARLIE;
    const userId = 'user-123';

    it('should use ElevenLabs for premium users', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockCheckUsage.mockResolvedValue(true);
      mockElevenLabsGenerate.mockResolvedValue(Buffer.from('eleven-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/eleven.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockUploadAudio).toHaveBeenCalledWith(
        Buffer.from('eleven-audio'),
        expect.stringContaining('elevenlabs'),
      );
      expect(result).toBe('https://uploaded-audio.com/eleven.mp3');
      expect(mockStyleTts2Generate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
      expect(mockIncrementUsage).toHaveBeenCalledWith(userId);
      expect(mockPrisma.paragraphAudioCache.upsert).toHaveBeenCalled();
    });

    it('should skip ElevenLabs for free users and try StyleTTS2', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('styletts2-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/styletts2.wav',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/styletts2.wav');
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
    });

    it('should fallback to Edge TTS if StyleTTS2 fails', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 timeout'));
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/edge.mp3');

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/edge.mp3');
    });

    it('should fallback through all 3 tiers for premium users', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockCheckUsage.mockResolvedValue(true);
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 Error'));
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/edge.mp3');

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/edge.mp3');
      expect(mockIncrementUsage).not.toHaveBeenCalled();
    });

    it('should return cached URL without calling any provider', async () => {
      mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue({
        audioUrl: 'https://cached.com/audio.mp3',
      });

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(result).toBe('https://cached.com/audio.mp3');
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockStyleTts2Generate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
    });

    it('should throw error if all providers fail for premium user', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockCheckUsage.mockResolvedValue(true);
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 Error'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS Error'));

      await expect(
        service.textToSpeechCloudUrl(storyId, text, voiceType, userId),
      ).rejects.toThrow('Voice generation failed on all providers');
    });

    it('should throw error if all providers fail for free user', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 Error'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS Error'));

      await expect(
        service.textToSpeechCloudUrl(storyId, text, voiceType, userId),
      ).rejects.toThrow('Voice generation failed on all providers');
    });

    it('should deny anonymous requests for ElevenLabs voices', async () => {
      // No userId provided — should skip ElevenLabs, use StyleTTS2
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('styletts2-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/styletts2.wav',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        // no userId
      );

      expect(mockIsPremiumUser).not.toHaveBeenCalled();
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/styletts2.wav');
    });

    it('should skip ElevenLabs when premium user exceeds quota', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockCheckUsage.mockResolvedValue(false); // quota exceeded
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('styletts2-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/styletts2.wav',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockIsPremiumUser).toHaveBeenCalledWith(userId);
      expect(mockCheckUsage).toHaveBeenCalledWith(userId);
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/styletts2.wav');
    });

    it('should resolve custom UUID voice from database', async () => {
      const customVoiceId = '550e8400-e29b-41d4-a716-446655440000';
      mockPrisma.voice.findUnique.mockResolvedValue({
        id: customVoiceId,
        elevenLabsVoiceId: 'custom-eleven-id',
      });
      mockIsPremiumUser.mockResolvedValue(true);
      mockCheckUsage.mockResolvedValue(true);
      mockElevenLabsGenerate.mockResolvedValue(Buffer.from('custom-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/custom.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        customVoiceId,
        userId,
      );

      expect(mockPrisma.voice.findUnique).toHaveBeenCalledWith({
        where: { id: customVoiceId },
      });
      expect(mockElevenLabsGenerate).toHaveBeenCalledWith(
        expect.any(String),
        'custom-eleven-id',
        expect.any(String),
        expect.any(Object),
      );
      expect(result).toBe('https://uploaded-audio.com/custom.mp3');
    });

    it('should fallback to default for unrecognized voice ID', async () => {
      const unknownId = 'unknown-voice-id';
      mockPrisma.voice.findUnique.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('default-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/default.wav',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        unknownId,
        userId,
      );

      expect(mockPrisma.voice.findUnique).toHaveBeenCalledWith({
        where: { id: unknownId },
      });
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/default.wav');
    });

    it('should throw when text exceeds max length', async () => {
      const longText = 'x'.repeat(MAX_TTS_TEXT_LENGTH + 1);

      await expect(
        service.textToSpeechCloudUrl(storyId, longText, voiceType, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use default voice when voicetype is not provided', async () => {
      mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/audio.wav');

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        undefined,
        userId,
      );

      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/audio.wav');
    });

    it('should still return audio when cache write fails', async () => {
      mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/audio.wav');
      mockPrisma.paragraphAudioCache.upsert.mockRejectedValue(
        new Error('DB write failed'),
      );

      // Should not throw — cache failure is non-fatal
      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(result).toBe('https://uploaded-audio.com/audio.wav');
    });
  });
});
