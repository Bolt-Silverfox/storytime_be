import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { ElevenLabsClient } from 'elevenlabs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

@Injectable()
export class ElevenLabsTTSProvider implements ITextToSpeechProvider {
    private readonly logger = new Logger(ElevenLabsTTSProvider.name);
    private client: ElevenLabsClient;
    public readonly name = 'ElevenLabs';

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
        if (apiKey) {
            try {
                this.client = new ElevenLabsClient({ apiKey });
            } catch (err) {
                this.logger.error(`Failed to initialize ElevenLabs client: ${err.message}`);
            }
        } else {
            this.logger.warn('ELEVEN_LABS_KEY is not set');
        }
    }

    async generateAudio(text: string, voiceId: string, modelId: string = 'eleven_multilingual_v2'): Promise<Buffer> {
        if (!this.client) {
            throw new Error('ElevenLabs client is not initialized');
        }

        try {
            this.logger.log(`Generating audio with voice ${voiceId}`);
            const audioStream = await this.client.textToSpeech.convert(voiceId, {
                text,
                model_id: modelId,
                output_format: 'mp3_44100_128',
            });

            return await this.streamToBuffer(audioStream);
        } catch (error) {
            this.logger.error(`ElevenLabs generation failed: ${error.message}`);
            throw error;
        }
    }

    private async streamToBuffer(stream: Readable): Promise<Buffer> {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }
}
