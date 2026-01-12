import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ElevenLabsSTTProvider } from './providers/eleven-labs-stt.provider';
import { DeepgramSTTProvider } from './providers/deepgram-stt.provider';

@Injectable()
export class SpeechToTextService {
    private readonly logger = new Logger(SpeechToTextService.name);

    constructor(
        private readonly elevenLabsProvider: ElevenLabsSTTProvider,
        private readonly deepgramProvider: DeepgramSTTProvider,
    ) { }

    async transcribeAudio(buffer: Buffer, mimetype: string): Promise<string> {
        // Priority 1: ElevenLabs
        try {
            this.logger.log('Attempting ElevenLabs STT transcription');
            return await this.elevenLabsProvider.transcribe(buffer, mimetype);
        } catch (error) {
            this.logger.warn(`ElevenLabs STT failed: ${error.message}. Falling back to Deepgram.`);
            // Proceed to fallback
        }

        // Priority 2: Deepgram Fallback
        try {
            this.logger.log('Attempting Deepgram STT transcription');
            return await this.deepgramProvider.transcribe(buffer, mimetype);
        } catch (error) {
            this.logger.error(`Deepgram STT failed: ${error.message}`);
            throw new InternalServerErrorException('Speech to text failed on both providers');
        }
    }
}
