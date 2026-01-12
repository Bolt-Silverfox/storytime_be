import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@deepgram/sdk';
import { ElevenLabsClient } from 'elevenlabs';
import { Readable } from 'stream';

@Injectable()
export class SpeechToTextService {
    private readonly logger = new Logger(SpeechToTextService.name);
    private deepgramApiKey: string;
    private elevenLabsApiKey: string;
    private elevenLabs: ElevenLabsClient;

    constructor(private readonly configService: ConfigService) {
        this.deepgramApiKey = this.configService.get<string>('DEEPGRAM_API_KEY') ?? '';
        this.elevenLabsApiKey = this.configService.get<string>('ELEVEN_LABS_KEY') ?? '';

        if (this.elevenLabsApiKey) {
            try {
                this.elevenLabs = new ElevenLabsClient({ apiKey: this.elevenLabsApiKey });
            } catch (err) {
                this.logger.error(`Failed to initialize ElevenLabs client: ${err.message}`);
            }
        } else {
            this.logger.warn('ELEVEN_LABS_KEY is not set');
        }

        if (!this.deepgramApiKey) {
            this.logger.warn('DEEPGRAM_API_KEY is not set');
        }
    }

    async transcribeAudio(buffer: Buffer, mimetype: string): Promise<string> {
        // Priority 1: ElevenLabs
        if (this.elevenLabs) {
            try {
                this.logger.log('Attempting ElevenLabs STT transcription');
                return await this.transcribeElevenLabs(buffer, mimetype);
            } catch (error) {
                this.logger.warn(`ElevenLabs STT failed: ${error.message}. Falling back to Deepgram.`);
                // Proceed to fallback
            }
        }

        // Priority 2: Deepgram Fallback
        if (this.deepgramApiKey) {
            try {
                this.logger.log('Attempting Deepgram STT transcription');
                return await this.transcribeDeepgram(buffer, mimetype);
            } catch (error) {
                this.logger.error(`Deepgram STT failed: ${error.message}`);
                throw new InternalServerErrorException('Speech to text failed on both providers');
            }
        }

        throw new InternalServerErrorException('No speech to text provider available');
    }

    private async transcribeElevenLabs(buffer: Buffer, mimetype: string): Promise<string> {
        try {
            const result = await this.elevenLabs.speechToText.convert({
                file: new Blob([new Uint8Array(buffer)], { type: mimetype }),
                model_id: 'scribe_v2', // Updated to Scribe v2 for better long-form transcription
                tag_audio_events: true,
                diarize: false,
            });

            return result.text;
        } catch (error) {
            throw error;
        }
    }

    private async transcribeDeepgram(buffer: Buffer, mimetype: string): Promise<string> {
        const deepgram = createClient(this.deepgramApiKey);

        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            buffer,
            {
                model: 'nova-2',
                smart_format: true,
                mimetype: mimetype, // e.g., 'audio/mp3' or 'audio/wav'
            }
        );

        if (error) {
            throw new Error(error.message);
        }

        return result.results.channels[0].alternatives[0].transcript;
    }
}
