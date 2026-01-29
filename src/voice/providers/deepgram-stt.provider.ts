import { ISpeechToTextProvider } from '../interfaces/speech-provider.interface';
import { createClient, DeepgramClient } from '@deepgram/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DeepgramSTTProvider implements ISpeechToTextProvider {
    private readonly logger = new Logger(DeepgramSTTProvider.name);
    private deepgram: DeepgramClient;
    public readonly name = 'Deepgram';

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('DEEPGRAM_API_KEY');
        if (apiKey) {
            this.deepgram = createClient(apiKey);
        } else {
            this.logger.warn('DEEPGRAM_API_KEY is not set');
        }
    }

    async transcribe(buffer: Buffer, mimetype: string): Promise<string> {
        if (!this.deepgram) {
            throw new Error('Deepgram client is not initialized');
        }

        try {
            this.logger.log('Attempting Deepgram STT transcription');
            const { result, error } = await this.deepgram.listen.prerecorded.transcribeFile(
                buffer,
                {
                    model: 'nova-2',
                    smart_format: true,
                    mimetype: mimetype,
                }
            );

            if (error) {
                throw new Error(error.message);
            }

            return result.results.channels[0].alternatives[0].transcript;
        } catch (error) {
            this.logger.error(`Deepgram STT failed: ${error.message}`);
            throw error;
        }
    }
}
