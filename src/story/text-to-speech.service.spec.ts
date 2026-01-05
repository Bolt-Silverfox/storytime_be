
import { Test, TestingModule } from '@nestjs/testing';
import { TextToSpeechService } from './text-to-speech.service';
import { ConfigService } from '@nestjs/config';
import { UploadService } from '../upload/upload.service';
import { VoiceType, VOICE_CONFIG } from '../voice/voice.dto';
import { ElevenLabsClient } from 'elevenlabs';
import { createClient } from '@deepgram/sdk';

// Manual mock for elevenlabs to ensure named export works
jest.mock('elevenlabs', () => {
    return {
        ElevenLabsClient: jest.fn().mockImplementation(() => ({
            textToSpeech: {
                convert: jest.fn(),
            },
        })),
    };
});

jest.mock('@deepgram/sdk');

describe('TextToSpeechService', () => {
    let service: TextToSpeechService;
    let configService: ConfigService;
    let uploadService: UploadService;

    let mockElevenLabsConvert: jest.Mock;
    const mockDeepgramSpeak = jest.fn();
    const mockUploadAudio = jest.fn();

    beforeEach(async () => {
        jest.clearAllMocks();

        let clientInstance: any;
        (ElevenLabsClient as unknown as jest.Mock).mockImplementation(() => {
            mockElevenLabsConvert = jest.fn();
            clientInstance = {
                textToSpeech: {
                    convert: mockElevenLabsConvert
                }
            };
            return clientInstance;
        });

        // We need to re-assign mockElevenLabsConvert after the service is instantiated
        // but the test runs logic that uses the instance created IN the service constructor.
        // So we need to capture the mock function from the constructor call.
        // However, simpler way: define the mock function outside.

        mockElevenLabsConvert = jest.fn();
        (ElevenLabsClient as unknown as jest.Mock).mockImplementation(() => ({
            textToSpeech: {
                convert: mockElevenLabsConvert,
            },
        }));

        (createClient as unknown as jest.Mock).mockReturnValue({
            speak: {
                request: mockDeepgramSpeak,
            },
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TextToSpeechService,
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key) => {
                            if (key === 'ELEVEN_LABS_KEY') return 'test-eleven-key';
                            if (key === 'DEEPGRAM_API_KEY') return 'test-deepgram-key';
                            return null;
                        }),
                    },
                },
                {
                    provide: UploadService,
                    useValue: {
                        uploadAudioBuffer: mockUploadAudio,
                    },
                },
            ],
        }).compile();

        service = module.get<TextToSpeechService>(TextToSpeechService);
        configService = module.get<ConfigService>(ConfigService);
        uploadService = module.get<UploadService>(UploadService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('textToSpeechCloudUrl', () => {
        const storyId = 'story-123';
        const text = 'Once upon a time';
        const voiceType = VoiceType.MILO;

        it('should prioritize ElevenLabs and return url on success', async () => {
            const mockStream = (async function* () {
                yield Buffer.from('audio-chunk');
            })();
            mockElevenLabsConvert.mockResolvedValue(mockStream);
            mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/eleven.mp3');

            const result = await service.textToSpeechCloudUrl(storyId, text, voiceType);

            expect(mockElevenLabsConvert).toHaveBeenCalledWith(
                VOICE_CONFIG[voiceType].elevenLabsId,
                expect.anything()
            );
            expect(mockUploadAudio).toHaveBeenCalled();
            expect(result).toBe('https://uploaded-audio.com/eleven.mp3');
            expect(mockDeepgramSpeak).not.toHaveBeenCalled();
        });

        it('should fallback to Deepgram if ElevenLabs fails', async () => {
            mockElevenLabsConvert.mockRejectedValue(new Error('ElevenLabs Error'));

            const mockDeepgramResponse = {
                getStream: jest.fn().mockResolvedValue({
                    getReader: () => ({
                        read: jest.fn()
                            .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                            .mockResolvedValueOnce({ done: true })
                    })
                })
            };
            mockDeepgramSpeak.mockResolvedValue(mockDeepgramResponse);
            mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/deepgram.wav');

            const result = await service.textToSpeechCloudUrl(storyId, text, voiceType);

            expect(mockElevenLabsConvert).toHaveBeenCalled();
            expect(mockDeepgramSpeak).toHaveBeenCalled();
            expect(result).toBe('https://uploaded-audio.com/deepgram.wav');
        });

        it('should throw error if both providers fail', async () => {
            mockElevenLabsConvert.mockRejectedValue(new Error('ElevenLabs Error'));
            mockDeepgramSpeak.mockRejectedValue(new Error('Deepgram Error'));

            await expect(service.textToSpeechCloudUrl(storyId, text, voiceType))
                .rejects.toThrow('Voice generation failed on both providers');
        });
    });
});
