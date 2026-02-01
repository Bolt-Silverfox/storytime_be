import { ITextToSpeechProvider, IVoiceCloningProvider } from '../interfaces/speech-provider.interface';
import { ElevenLabsClient } from 'elevenlabs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { StreamConverter } from '../utils/stream-converter';

@Injectable()
export class ElevenLabsTTSProvider implements ITextToSpeechProvider, IVoiceCloningProvider {
    private readonly logger = new Logger(ElevenLabsTTSProvider.name);
    private client: ElevenLabsClient;
    public readonly name = 'ElevenLabs';

    constructor(
        private readonly configService: ConfigService,
        private readonly converter: StreamConverter,
    ) {
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

    async generateAudio(text: string, voiceId: string, modelId: string = 'eleven_multilingual_v2', options?: any): Promise<Buffer> {
        if (!this.client) {
            throw new Error('ElevenLabs client is not initialized');
        }

        try {
            this.logger.log(`Generating audio with voice ${voiceId} and model ${modelId}`);

            const convertOptions: any = {
                text,
                model_id: modelId,
                output_format: 'mp3_44100_128',
            };

            if (options) {
                convertOptions.voice_settings = options;
            }

            const audioStream = await this.client.textToSpeech.convert(voiceId, convertOptions);

            return await this.converter.toBuffer(audioStream);
        } catch (error) {
            this.logger.error(`ElevenLabs generation failed: ${error.message}`);
            throw error;
        }
    }


    async addVoice(name: string, fileBuffer: Buffer): Promise<string> {
        if (!this.client) {
            throw new Error('ElevenLabs client is not initialized');
        }

        try {
            this.logger.log(`Cloning voice "${name}"...`);
            const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'audio/mpeg' });

            const response = await this.client.voices.add({
                name,
                files: [blob as any], // Cast to any because SDK types might be strict about File/Blob
                description: 'Cloned via StoryTime App',
            });

            return response.voice_id;
        } catch (error) {
            this.logger.error(`ElevenLabs voice cloning failed: ${error.message}`);
            throw error;
        }
    }

    async getSubscriptionInfo(): Promise<any> {
        if (!this.client) {
            throw new Error('ElevenLabs client is not initialized');
        }

        try {
            return await this.client.user.getSubscription();
        } catch (error) {
            this.logger.error(`Failed to fetch ElevenLabs subscription info: ${error.message}`);
            throw error;
        }
    }
}
