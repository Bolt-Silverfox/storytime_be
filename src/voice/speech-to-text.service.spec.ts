
import { Test, TestingModule } from '@nestjs/testing';
import { SpeechToTextService } from './speech-to-text.service';
import { ElevenLabsSTTProvider } from './providers/eleven-labs-stt.provider';
import { DeepgramSTTProvider } from './providers/deepgram-stt.provider';

describe('SpeechToTextService', () => {
    let service: SpeechToTextService;
    let elevenLabsProvider: ElevenLabsSTTProvider;
    let deepgramProvider: DeepgramSTTProvider;

    const mockElevenLabsTranscribe = jest.fn();
    const mockDeepgramTranscribe = jest.fn();

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SpeechToTextService,
                {
                    provide: ElevenLabsSTTProvider,
                    useValue: {
                        transcribe: mockElevenLabsTranscribe,
                    },
                },
                {
                    provide: DeepgramSTTProvider,
                    useValue: {
                        transcribe: mockDeepgramTranscribe,
                    },
                },
            ],
        }).compile();

        service = module.get<SpeechToTextService>(SpeechToTextService);
        elevenLabsProvider = module.get<ElevenLabsSTTProvider>(ElevenLabsSTTProvider);
        deepgramProvider = module.get<DeepgramSTTProvider>(DeepgramSTTProvider);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('transcribeAudio', () => {
        const buffer = Buffer.from('audio');
        const mimetype = 'audio/mp3';

        it('should prioritize ElevenLabs and return text on success', async () => {
            mockElevenLabsTranscribe.mockResolvedValue('transcription result');

            const result = await service.transcribeAudio(buffer, mimetype);

            expect(mockElevenLabsTranscribe).toHaveBeenCalledWith(buffer, mimetype);
            expect(result).toBe('transcription result');
            expect(mockDeepgramTranscribe).not.toHaveBeenCalled();
        });

        it('should fallback to Deepgram if ElevenLabs fails', async () => {
            mockElevenLabsTranscribe.mockRejectedValue(new Error('ElevenLabs failure'));
            mockDeepgramTranscribe.mockResolvedValue('deepgram result');

            const result = await service.transcribeAudio(buffer, mimetype);

            expect(mockElevenLabsTranscribe).toHaveBeenCalled();
            expect(mockDeepgramTranscribe).toHaveBeenCalledWith(buffer, mimetype);
            expect(result).toBe('deepgram result');
        });

        it('should throw error if both providers fail', async () => {
            mockElevenLabsTranscribe.mockRejectedValue(new Error('ElevenLabs failure'));
            mockDeepgramTranscribe.mockRejectedValue(new Error('Deepgram failure'));

            await expect(service.transcribeAudio(buffer, mimetype))
                .rejects.toThrow('Speech to text failed on both providers');
        });
    });
});
