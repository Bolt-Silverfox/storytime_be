import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class GoogleTTSService {
    private readonly logger = new Logger(GoogleTTSService.name);
    private readonly apiKey: string;
    private readonly apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize';

    // Default voice configuration
    private readonly defaultVoice = {
        languageCode: 'en-US',
        name: 'en-US-Neural2-F', // Default female voice
        ssmlGender: 'FEMALE',
    };

    constructor(private readonly configService: ConfigService) {
        this.apiKey = this.configService.get<string>('GOOGLE_TTS_API_KEY');
        if (!this.apiKey) {
            throw new Error('GOOGLE_TTS_API_KEY is not set');
        }
    }

    async generateAudioBuffer(
        text: string,
        voiceId?: string,
    ): Promise<{ buffer: Buffer; filename: string }> {
        try {
            const voiceConfig = this.getVoiceConfig(voiceId);

            const requestBody = {
                input: { text },
                voice: voiceConfig,
                audioConfig: {
                    audioEncoding: 'MP3',
                },
            };

            const response = await axios.post(
                `${this.apiUrl}?key=${this.apiKey}`,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );

            if (!response.data.audioContent) {
                throw new Error('No audio content received from Google TTS');
            }

            const buffer = Buffer.from(response.data.audioContent, 'base64');
            const filename = `story-${Date.now()}.mp3`;

            return { buffer, filename };
        } catch (error) {
            this.logger.error(
                'Failed to generate audio with Google TTS',
                error.response?.data || error.message,
            );
            throw error;
        }
    }

    private getVoiceConfig(voiceId?: string) {
        // Map existing ElevenLabs voice IDs or names to Google TTS voices
        // This is a basic mapping, can be expanded
        const voiceMap: Record<string, any> = {
            'MILO': { languageCode: 'en-US', name: 'en-US-Neural2-D', ssmlGender: 'MALE' },
            'BELLA': { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },
            'COSMO': { languageCode: 'en-US', name: 'en-US-Neural2-A', ssmlGender: 'MALE' }, // Using Neural2-A as generic male
            'NIMBUS': { languageCode: 'en-US', name: 'en-US-Neural2-C', ssmlGender: 'FEMALE' },
            'GRANDPA_JO': { languageCode: 'en-US', name: 'en-US-Polyglot-1', ssmlGender: 'MALE' }, // Deeper voice if available
            'CHIP': { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' }, // Higher pitch often in Wavenet-F
        };

        // Check if voiceId matches one of our keys
        if (voiceId && voiceMap[voiceId]) {
            return voiceMap[voiceId];
        }

        // Also check if voiceId matches the ElevenLabs IDs from the DTO
        // We can reverse lookup or just add them to the map.
        // For now, if no match, return default.
        return this.defaultVoice;
    }
}
