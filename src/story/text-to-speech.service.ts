import { UploadService } from '@/upload/upload.service';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { VOICEID, VoiceType } from './story.dto';

@Injectable()
export class TextToSpeechService {
  private elevenLabsApiKey: string;
  private cloudinaryApiKey: string;
  private cloudinaryApiSecret: string;
  private cloudinaryCloudName: string;
  private readonly logger = new Logger(TextToSpeechService.name);

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

  async textToSpeechCloudUrl(
    textId: string,
    text: string,
    voiceIdOrType?: string,
  ): Promise<string> {
    try {
      // Logic: If voiceIdOrType matches a key in VOICEID (e.g. 'MILO'), use that ID.
      // Otherwise, assume voiceIdOrType IS the actual ElevenLabs ID.
      const resolvedVoiceId = VOICEID[voiceIdOrType as keyof typeof VOICEID] || voiceIdOrType || VOICEID.MILO;

      const audioBuffer = await this.getElevenLabsAudio(
        text,
        resolvedVoiceId,
      );

      const cloudUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${textId}_${resolvedVoiceId}_${Date.now()}.mp3`,
      );

      return cloudUrl;
    } catch (error) {
      this.logger.error('Text-to-speech failed', error); 
      throw new InternalServerErrorException('Text-to-speech failed');
    }
  }

  private async getElevenLabsAudio(
    text: string,
    voiceId: string,
  ): Promise<Buffer> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    //Used 'eleven_multilingual_v2' instead of 'eleven_monolingual_v1'
    const modelId = 'eleven_multilingual_v2';

    const response = await axios.post(
      url,
      {
        text,
        model_id: modelId,
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
