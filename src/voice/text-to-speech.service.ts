import { UploadService } from '@/upload/upload.service';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { VoiceType } from './dto/voice.dto';
import { EnvConfig } from '@/shared/config/env.validation';

const VOICE_IDS: Record<VoiceType, string> = {
  [VoiceType.CHARLIE]: 'IKne3meq5aSn9XLyUdCD',
  [VoiceType.JESSICA]: 'cgSgspJ2msm6clMCkdW9',
  [VoiceType.WILL]: 'bIHbv24MWmeRgasZH58o',
  [VoiceType.LILY]: 'AZnzlk1XvdvUeBnXmlld',
  [VoiceType.BILL]: 'pqHfZKP75CvOlQylNhV4',
  [VoiceType.LAURA]: 'FGY2WhTYpPnrIDTdsKH5',
  [VoiceType.ROSIE]: 'ThT5KcBeYPX3keUQqHPh',
  [VoiceType.PIXIE]: 'jBpfuIE2acCO8z3wKNLl',
};

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);
  private readonly elevenLabsApiKey: string;
  private readonly maxRetries = 3;
  private readonly defaultVoice = VOICE_IDS[VoiceType.CHARLIE];

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly uploadService: UploadService,
  ) {
    // Config values are validated at startup by Zod in env.validation.ts
    this.elevenLabsApiKey = this.configService.get('ELEVEN_LABS_KEY');
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
    const voiceId =
      VOICE_IDS[voicetype ?? VoiceType.CHARLIE] || this.defaultVoice;

    let audioBuffer: Buffer | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        audioBuffer = await this.getElevenLabsAudio(text, voiceId);
        break;
      } catch (error) {
        this.logger.error(
          `TTS attempt ${attempt} failed for voice ${voiceId}: ${(error as Error).message}`,
        );

        if (attempt === this.maxRetries) {
          this.logger.warn('All TTS retries failed, falling back to default voice');
          try {
            audioBuffer = await this.getElevenLabsAudio(
              text,
              this.defaultVoice,
            );
          } catch (fallbackError) {
            this.logger.error(`Fallback TTS also failed: ${(fallbackError as Error).message}`);
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
