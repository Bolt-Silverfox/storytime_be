import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ElevenLabsService {
    private readonly logger = new Logger(ElevenLabsService.name);
    private readonly baseUrl = 'https://api.elevenlabs.io/v1';

    // CHANGED: Use the UUID for Rachel, not the name 'Rachel'
    private readonly defaultVoice = '21m00Tcm4TlvDq8ikWAM';

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

    async generateAudioBuffer(
        text: string,
        voice: string = this.defaultVoice,
    ): Promise<{ buffer: Buffer; filename: string }> {
        try {
            const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');

            const response = await firstValueFrom(
                this.httpService.post(
                    `${this.baseUrl}/text-to-speech/${voice}`,
                    { text },
                    {
                        headers: {
                            'xi-api-key': apiKey,
                            'Content-Type': 'application/json',
                        },
                        responseType: 'arraybuffer',
                    },
                ),
            );
            const buffer = Buffer.from(response.data);
            const filename = `story-${Date.now()}.mp3`;
            return { buffer, filename };
        } catch (error) {
            this.logger.error('Failed to generate audio with Eleven Labs', error.response?.data || error.message);
            throw error;
        }
    }

    async fetchAvailableVoices(): Promise<any[]> {
        const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
        const response = await firstValueFrom(
            this.httpService.get('https://api.elevenlabs.io/v1/voices', {
                headers: { 'xi-api-key': apiKey },
            }),
        );
        return response.data.voices;
    }
}