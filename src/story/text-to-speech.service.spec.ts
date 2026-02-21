import { Test, TestingModule } from '@nestjs/testing';
import { TextToSpeechService } from './text-to-speech.service';
import { UploadService } from '../upload/upload.service';
import { VoiceType } from '../voice/dto/voice.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { StyleTTS2TTSProvider } from '../voice/providers/styletts2-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';

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
            isPremiumUser: mockIsPremiumUser,
            checkUsage: mockCheckUsage,
            incrementUsage: mockIncrementUsage,
          },
        },
      ],
    }).compile();

    service = module.get<TextToSpeechService>(TextToSpeechService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
    });

    it('should throw error if all providers fail', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 Error'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS Error'));

      await expect(
        service.textToSpeechCloudUrl(storyId, text, voiceType, userId),
      ).rejects.toThrow('Voice generation failed on all providers');
    });
  });
});
