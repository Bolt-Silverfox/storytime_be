import { UploadService } from '@/upload/upload.service';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { VOICEID, VoiceType } from './story.dto';

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
    if (!this.elevenLabsApiKey) throw new Error('ELEVEN_LABS_KEY is not set');
    
    this.cloudinaryApiKey =
      this.configService.get<string>('CLOUDINARY_API_KEY') ?? '';
    if (!this.cloudinaryApiKey) throw new Error('CLOUDINARY_API_KEY is not set');
    
    this.cloudinaryApiSecret =
      this.configService.get<string>('CLOUDINARY_API_SECRET') ?? '';
    if (!this.cloudinaryApiSecret)
      throw new Error('CLOUDINARY_API_SECRET is not set');
    
    this.cloudinaryCloudName =
      this.configService.get<string>('CLOUDINARY_CLOUD_NAME') ?? '';
    if (!this.cloudinaryCloudName)
      throw new Error('CLOUDINARY_CLOUD_NAME is not set');
  }

  async textToSpeechCloudUrl(
    textId: string,
    text: string,
    voicetype?: VoiceType,
  ): Promise<string> {
    const preferredVoice = voicetype ?? VoiceType.MILO;
    try {
      const audioBuffer = await this.generateTTSWithRetry(
        text,
        VOICEID[preferredVoice],
      );

      const cloudUrl = await this.uploadService.uploadAudioBuffer(
        audioBuffer,
        `story_${textId}_${preferredVoice}_${Date.now()}.mp3`,
      );

      return cloudUrl;
    } catch (error) {
      console.error('TTS failed completely:', error);
      // Optionally return empty string to allow story progression
      return '';
    }
  }

  // Retry wrapper with fallback
  private async generateTTSWithRetry(
    text: string,
    voiceId: string,
    maxRetries = 3,
    fallbackVoiceId = VOICEID[VoiceType.MILO], // default fallback
  ): Promise<Buffer> {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        return await this.getElevenLabsAudio(text, voiceId);
      } catch (error) {
        attempt++;
        console.error(`TTS attempt ${attempt} failed:`, error.message);
        // Could also log to analytics here
      }
    }

    console.warn(`All retries failed, using fallback voice`);
    try {
      return await this.getElevenLabsAudio(text, fallbackVoiceId);
    } catch (fallbackError) {
      console.error('Fallback TTS also failed:', fallbackError.message);
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
      { text, model_id: 'eleven_monolingual_v1' },
      {
        headers: { 'xi-api-key': this.elevenLabsApiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
      },
    );
    return Buffer.from(response.data);
  }
}
