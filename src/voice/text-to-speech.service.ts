import { UploadService } from '@/upload/upload.service';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { VOICEID, VoiceType } from './voice.dto';

@Injectable()
export class TextToSpeechService {
  private elevenLabsApiKey: string;
  private cloudinaryApiKey: string;
  private cloudinaryApiSecret: string;
  private cloudinaryCloudName: string;

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
    voicetype?: VoiceType,
  ): Promise<string> {
    try {
      const audioBuffer = await this.getElevenLabsAudio(
        text,
        VOICEID[voicetype ?? VoiceType.MILO],
      );

      const cloudUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${textId}_${voicetype}_${Date.now()}.mp3`,
      );

      return cloudUrl;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException('Text-to-speech failed');
    }
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
        model_id: 'eleven_monolingual_v1', // or other model
      },
      {
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer', // <--- so we get audio as a buffer
      },
    );
    return Buffer.from(response.data); // MP3 buffer
  }
}
