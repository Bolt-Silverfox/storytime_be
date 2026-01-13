import { ITextToSpeechProvider } from '../interfaces/speech-provider.interface';
import { createClient, DeepgramClient } from '@deepgram/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SSMLFormatter } from '../utils/ssml-formatter';
import { TextChunker } from '../utils/text-chunker';
import { StreamConverter } from '../utils/stream-converter';

@Injectable()
export class DeepgramTTSProvider implements ITextToSpeechProvider {
    private readonly logger = new Logger(DeepgramTTSProvider.name);
    private deepgram: DeepgramClient;
    public readonly name = 'Deepgram';
    private apiKey: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly formatter: SSMLFormatter,
        private readonly chunker: TextChunker,
        private readonly converter: StreamConverter,
    ) {
        this.apiKey = this.configService.get<string>('DEEPGRAM_API_KEY') ?? '';
        if (this.apiKey) {
            this.deepgram = createClient(this.apiKey);
        } else {
            this.logger.warn('DEEPGRAM_API_KEY is not set');
        }
    }

    async generateAudio(text: string, _voiceId?: string, model: string = 'aura-asteria-en'): Promise<Buffer> {
        if (!this.deepgram) {
            throw new Error('Deepgram client is not initialized');
        }

        // 1. Transform raw text into "Storyteller Mode" (SSML)
        const ssmlText = this.formatter.format(text);

        // Deepgram has a 2000 char limit. Split text into chunks.
        const MAX_CHARS = 1900; // Safety margin
        const chunks = this.chunker.chunk(ssmlText, MAX_CHARS);
        const audioBuffers: Buffer[] = [];

        this.logger.log(`Splitting text into ${chunks.length} chunks for Deepgram`);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // Ensure each chunk is wrapped in <speak> tags if not already
            const chunkSSML = chunk.startsWith('<speak>') ? chunk : `<speak>${chunk}</speak>`;

            try {
                const response = await this.deepgram.speak.request(
                    { text: chunkSSML },
                    {
                        model: model,
                        encoding: 'linear16',
                        container: 'wav',
                    },
                );

                const stream = await response.getStream();
                if (!stream) {
                    throw new Error('No audio stream returned from Deepgram');
                }
                audioBuffers.push(await this.converter.toBuffer(stream));
            } catch (innerError) {
                this.logger.error(`Failed on chunk ${i + 1}: ${innerError.message}`);
                throw innerError;
            }
        }

        return Buffer.concat(audioBuffers);
    }
}
