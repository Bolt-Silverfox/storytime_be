import { Test, TestingModule } from '@nestjs/testing';
import { TextToSpeechService } from './text-to-speech.service';
import { UploadService } from '../upload/upload.service';
import { VoiceType } from '../voice/dto/voice.dto';
import { VOICE_CONFIG } from '../voice/voice.constants';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { GoogleCloudTTSProvider } from '../voice/providers/google-cloud-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';

describe('TextToSpeechService', () => {
  let service: TextToSpeechService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let uploadService: UploadService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let elevenLabsProvider: ElevenLabsTTSProvider;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let googleCloudProvider: GoogleCloudTTSProvider;

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockGoogleCloudGenerate = jest.fn();
  const mockCheckUsage = jest.fn().mockResolvedValue(true);
  const mockIsPremiumUser = jest.fn().mockResolvedValue(true);
  const mockIncrementUsage = jest.fn();
  const mockFindUniqueParagraphCache = jest.fn().mockResolvedValue(null);
  const mockUpsertParagraphCache = jest.fn();

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
          provide: GoogleCloudTTSProvider,
          useValue: {
            generateAudio: mockGoogleCloudGenerate,
          },
        },
        {
          provide: PrismaService,
          useValue: {
            paragraphAudioCache: {
              findUnique: mockFindUniqueParagraphCache,
              upsert: mockUpsertParagraphCache,
            },
            voice: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          },
        },
        {
          provide: VoiceQuotaService,
          useValue: {
            checkUsage: mockCheckUsage,
            isPremiumUser: mockIsPremiumUser,
            incrementUsage: mockIncrementUsage,
          },
        },
      ],
    }).compile();

    service = module.get<TextToSpeechService>(TextToSpeechService);
    uploadService = module.get<UploadService>(UploadService);
    elevenLabsProvider = module.get<ElevenLabsTTSProvider>(
      ElevenLabsTTSProvider,
    );
    googleCloudProvider = module.get<GoogleCloudTTSProvider>(
      GoogleCloudTTSProvider,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('textToSpeechCloudUrl', () => {
    const storyId = 'story-123';
    const text = 'Once upon a time';
    const voiceType = VoiceType.CHARLIE;
    const userId = 'user-123';

    it('should prioritize ElevenLabs for premium users and return url on success', async () => {
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
      expect(mockGoogleCloudGenerate).not.toHaveBeenCalled();
    });

    it('should use Google Cloud TTS for free users', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockGoogleCloudGenerate.mockResolvedValue(Buffer.from('gcloud-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/gcloud.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockGoogleCloudGenerate).toHaveBeenCalledWith(
        expect.any(String),
        VOICE_CONFIG[voiceType].googleCloudVoice,
      );
      expect(result).toBe('https://uploaded-audio.com/gcloud.mp3');
    });

    it('should fallback to Google Cloud TTS if ElevenLabs fails', async () => {
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockGoogleCloudGenerate.mockResolvedValue(Buffer.from('gcloud-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/gcloud.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockGoogleCloudGenerate).toHaveBeenCalledWith(
        expect.any(String),
        VOICE_CONFIG[voiceType].googleCloudVoice,
      );
      expect(mockUploadAudio).toHaveBeenCalledWith(
        Buffer.from('gcloud-audio'),
        expect.stringContaining('gcloud'),
      );
      expect(result).toBe('https://uploaded-audio.com/gcloud.mp3');
    });

    it('should throw error if both providers fail', async () => {
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockGoogleCloudGenerate.mockRejectedValue(
        new Error('Google Cloud Error'),
      );

      await expect(
        service.textToSpeechCloudUrl(storyId, text, voiceType, userId),
      ).rejects.toThrow('Voice generation failed on both providers');
    });
  });
});
