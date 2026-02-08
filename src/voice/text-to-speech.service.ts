// import { UploadService } from '@/upload/upload.service';
// import { Injectable, InternalServerErrorException } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import axios from 'axios';
// import { VOICEID, VoiceType } from './dto/voice.dto';

// @Injectable()
// export class TextToSpeechService {
//     private elevenLabsApiKey: string;
//     private cloudinaryApiKey: string;
//     private cloudinaryApiSecret: string;
//     private cloudinaryCloudName: string;

//     // ADDED: Retry limit and default fallback voice
//     private readonly maxRetries = 3; // maximum retry attempts
//     private readonly defaultVoice = VOICEID[VoiceType.MILO]; // fallback default voice

//     constructor(
//         private readonly configService: ConfigService,
//         private readonly uploadService: UploadService,
//     ) {
//         this.elevenLabsApiKey =
//             this.configService.get<string>('ELEVEN_LABS_KEY') ?? '';
//         if (!this.elevenLabsApiKey) {
//             throw new Error('ELEVEN_LABS_KEY is not set in environment variables');
//         }
//         this.cloudinaryApiKey =
//             this.configService.get<string>('CLOUDINARY_API_KEY') ?? '';
//         if (!this.cloudinaryApiKey) {
//             throw new Error('CLOUDINARY_API_KEY is not set in environment variables');
//         }
//         this.cloudinaryApiSecret =
//             this.configService.get<string>('CLOUDINARY_API_SECRET') ?? '';
//         if (!this.cloudinaryApiSecret) {
//             throw new Error(
//                 'CLOUDINARY_API_SECRET is not set in environment variables',
//             );
//         }
//         this.cloudinaryCloudName =
//             this.configService.get<string>('CLOUDINARY_CLOUD_NAME') ?? '';
//         if (!this.cloudinaryCloudName) {
//             throw new Error(
//                 'CLOUDINARY_CLOUD_NAME is not set in environment variables',
//             );
//         }
//     }

//     async textToSpeechCloudUrl(
//         textId: string,
//         text: string,
//         voicetype?: VoiceType,
//     ): Promise<string> {
//         const voiceId = VOICEID[voicetype ?? VoiceType.MILO]; // ADDED: Determine voice ID

//         let audioBuffer: Buffer | null = null; // ADDED: Will store TTS audio

//         // ADDED: Retry logic
//         for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
//             try {
//                 audioBuffer = await this.getElevenLabsAudio(text, voiceId);
//                 break; // success, exit loop
//             } catch (error) {
//                 console.error(
//                     `TTS attempt ${attempt} failed for voice ${voiceId}:`,
//                     error,
//                 ); // ✅ ADDED structured logging

//                 if (attempt === this.maxRetries) {
//                     console.warn('All TTS retries failed, falling back to default voice'); // ✅ ADDED fallback log
//                     try {
//                         audioBuffer = await this.getElevenLabsAudio(
//                             text,
//                             this.defaultVoice,
//                         ); // ✅ ADDED fallback to default voice
//                     } catch (fallbackError) {
//                         console.error('Fallback TTS also failed:', fallbackError); // ✅ ADDED
//                         throw new InternalServerErrorException(
//                             'Text-to-speech failed after retries',
//                         ); // ✅ ADDED proper exception
//                     }
//                 }
//             }
//         }

//         const cloudUrl = await this.uploadService.uploadAudioBuffer(
//             audioBuffer!, // ✅ ADDED: ensured buffer is not null
//             `story_${textId}_${voicetype}_${Date.now()}.mp3`,
//         );

//         return cloudUrl;
//     }

//     private async getElevenLabsAudio(
//         text: string,
//         voiceId: string,
//     ): Promise<Buffer> {
//         const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
//         const response = await axios.post(
//             url,
//             {
//                 text,
//                 model_id: 'eleven_monolingual_v1', // or other model
//             },
//             {
//                 headers: {
//                     'xi-api-key': this.elevenLabsApiKey,
//                     'Content-Type': 'application/json',
//                 },
//                 responseType: 'arraybuffer', // <--- so we get audio as a buffer
//             },
//         );
//         return Buffer.from(response.data); // MP3 buffer
//     }
// }
