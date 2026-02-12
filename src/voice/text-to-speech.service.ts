import { UploadService } from '@/upload/upload.service';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { VoiceType } from './dto/voice.dto';

const VOICE_IDS: Record<VoiceType, string> = {
    [VoiceType.CHARLIE]: 'IKne3meq5aSn9XLyUdCD',
    [VoiceType.JESSICA]: 'cgSgspJ2msm6clMCkdW9',
    [VoiceType.WILL]: 'bIHbv24MWmeRgasZH58o',
    [VoiceType.LILY]: 'AZnzlk1XvdvUeBnXmlld',
    [VoiceType.BILL]: 'pqHfZKP75CvOlQylNhV4',
    [VoiceType.LAURA]: 'FGY2WhTYpPnrIDTdsKH5',
};

@Injectable()
export class TextToSpeechService {
    private elevenLabsApiKey: string;
    private cloudinaryApiKey: string;
    private cloudinaryApiSecret: string;
    private cloudinaryCloudName: string;

    private readonly maxRetries = 3;
    private readonly defaultVoice = VOICE_IDS[VoiceType.CHARLIE];

    constructor(
        private readonly configService: ConfigService,
        private readonly uploadService: UploadService,
    ) {
        this.elevenLabsApiKey =
            this.configService.get<string>('ELEVEN_LABS_KEY') ?? '';
        if (!this.elevenLabsApiKey) {
            throw new Error('ELEVEN_LABS_KEY is not set in environment variables');
        }
        this.cloudinaryApiKey =
            this.configService.get<string>('CLOUDINARY_API_KEY') ?? '';
        if (!this.cloudinaryApiKey) {
            throw new Error('CLOUDINARY_API_KEY is not set in environment variables');
        }
        this.cloudinaryApiSecret =
            this.configService.get<string>('CLOUDINARY_API_SECRET') ?? '';
        if (!this.cloudinaryApiSecret) {
            throw new Error(
                'CLOUDINARY_API_SECRET is not set in environment variables',
            );
        }
        this.cloudinaryCloudName =
            this.configService.get<string>('CLOUDINARY_CLOUD_NAME') ?? '';
        if (!this.cloudinaryCloudName) {
            throw new Error(
                'CLOUDINARY_CLOUD_NAME is not set in environment variables',
            );
        }
    }

    async synthesizeStory(
        textId: string,
        text: string,
        voicetype?: VoiceType,
    ): Promise<string> {
        return this.textToSpeechCloudUrl(textId, text, voicetype);
    }

    async textToSpeechCloudUrl(
        textId: string,
        text: string,
        voicetype?: VoiceType,
    ): Promise<string> {
        const voiceId = VOICE_IDS[voicetype ?? VoiceType.CHARLIE] || this.defaultVoice;

        let audioBuffer: Buffer | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                audioBuffer = await this.getElevenLabsAudio(text, voiceId);
                break;
            } catch (error) {
                console.error(
                    `TTS attempt ${attempt} failed for voice ${voiceId}:`,
                    error,
                );

                if (attempt === this.maxRetries) {
                    console.warn('All TTS retries failed, falling back to default voice');
                    try {
                        audioBuffer = await this.getElevenLabsAudio(
                            text,
                            this.defaultVoice,
                        );
                    } catch (fallbackError) {
                        console.error('Fallback TTS also failed:', fallbackError);
                        throw new InternalServerErrorException(
                            'Text-to-speech failed after retries',
                        );
                    }
                }
            }
        }

        if (!audioBuffer) {
            throw new InternalServerErrorException('Failed to generate audio buffer');
        }

        const cloudUrl = await this.uploadService.uploadAudioBuffer(
            audioBuffer,
            `story_${textId}_${voicetype}_${Date.now()}.mp3`,
        );

        return cloudUrl;
    }

    private async getElevenLabsAudio(
        text: string,
        voiceId: string,
    ): Promise<Buffer> {
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        const response = await axios.post(
            url,
            {
                text,
                model_id: 'eleven_monolingual_v1',
            },
            {
                headers: {
                    'xi-api-key': this.elevenLabsApiKey,
                    'Content-Type': 'application/json',
                },
                responseType: 'arraybuffer',
            },
        );
        return Buffer.from(response.data);
    }
}
