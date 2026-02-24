import { Test, TestingModule } from '@nestjs/testing';
import { TextToSpeechService } from './text-to-speech.service';
import { UploadService } from '../upload/upload.service';
import { VoiceType } from '../voice/dto/voice.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { StyleTTS2TTSProvider } from '../voice/providers/styletts2-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { STORY_REPOSITORY } from './repositories';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';

describe('TextToSpeechService', () => {
  let service: TextToSpeechService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let uploadService: UploadService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let elevenLabsProvider: ElevenLabsTTSProvider;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let styleTts2Provider: StyleTTS2TTSProvider;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let edgeTtsProvider: EdgeTTSProvider;

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockStyleTts2Generate = jest.fn();
  const mockEdgeTtsGenerate = jest.fn();

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
          provide: STORY_REPOSITORY,
          useValue: {
            findVoiceById: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            paragraphAudioCache: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: VoiceQuotaService,
          useValue: {
            checkUsage: jest.fn().mockResolvedValue(true),
            incrementUsage: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TextToSpeechService>(TextToSpeechService);
    uploadService = module.get<UploadService>(UploadService);
    elevenLabsProvider = module.get<ElevenLabsTTSProvider>(
      ElevenLabsTTSProvider,
    );
    styleTts2Provider = module.get<StyleTTS2TTSProvider>(StyleTTS2TTSProvider);
    edgeTtsProvider = module.get<EdgeTTSProvider>(EdgeTTSProvider);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('synthesizeStory', () => {
    const storyId = 'story-123';
    const text = 'Once upon a time';
    const voiceType = VoiceType.CHARLIE;

    it('should prioritize ElevenLabs and return url on success', async () => {
      mockElevenLabsGenerate.mockResolvedValue(Buffer.from('eleven-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/eleven.mp3',
      );

      const result = await service.synthesizeStory(
        storyId,
        text,
        voiceType,
        'user-123',
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

    it('should fallback to StyleTTS2 if ElevenLabs fails', async () => {
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockStyleTts2Generate.mockResolvedValue(Buffer.from('styletts2-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/styletts2.wav',
      );

      const result = await service.synthesizeStory(
        storyId,
        text,
        voiceType,
        'user-123',
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(mockUploadAudio).toHaveBeenCalledWith(
        Buffer.from('styletts2-audio'),
        expect.stringContaining('styletts2'),
      );
      expect(result).toBe('https://uploaded-audio.com/styletts2.wav');
    });

    it('should fallback to Edge TTS if both ElevenLabs and StyleTTS2 fail', async () => {
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 Error'));
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/edge.mp3');

      const result = await service.synthesizeStory(
        storyId,
        text,
        voiceType,
        'user-123',
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockStyleTts2Generate).toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(mockUploadAudio).toHaveBeenCalledWith(
        Buffer.from('edge-audio'),
        expect.stringContaining('edgetts'),
      );
      expect(result).toBe('https://uploaded-audio.com/edge.mp3');
    });

    it('should throw error if all providers fail', async () => {
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockStyleTts2Generate.mockRejectedValue(new Error('StyleTTS2 Error'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS Error'));

      await expect(
        service.synthesizeStory(storyId, text, voiceType, 'user-123'),
      ).rejects.toThrow('Voice generation failed on all providers');
    });
  });
});
