import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { StoryService } from '../story/story.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import {
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  StoryContentAudioDto,
  UploadVoiceDto,
  VoiceResponseDto,
  VoiceType,
} from './voice.dto';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceService } from './voice.service';

@ApiTags('Voice')
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly storyService: StoryService,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly speechToTextService: SpeechToTextService,
  ) { }

  @Post('upload')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
      },
      required: ['file', 'name'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a custom voice (audio file)' })
  async uploadVoiceFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadVoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.authUserData;

    // Upload file to Cloudinary
    const uploadResult = await this.uploadService.uploadFile(file);

    // Save voice record
    const voice = await this.voiceService.uploadVoice(
      userId,
      uploadResult.secure_url,
      dto,
    );

    return {
      message: 'Voice uploaded successfully',
      voice,
      cloudinary: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      },
    };
  }

  // --- Register ElevenLabs voice ---
  @Post('elevenlabs')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a custom ElevenLabs voice' })
  async createElevenLabsVoice(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateElevenLabsVoiceDto,
  ): Promise<VoiceResponseDto> {
    return this.voiceService.createElevenLabsVoice(
      req.authUserData.userId,
      body,
    );
  }

  // --- List user voices ---
  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all voices for the user' })
  async listVoices(
    @Req() req: AuthenticatedRequest,
  ): Promise<VoiceResponseDto[]> {
    return this.voiceService.listVoices(req.authUserData.userId);
  }

  // --- Set preferred voice ---
  @Patch('preferred')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set preferred voice for the user' })
  async setPreferredVoice(
    @Req() req: AuthenticatedRequest,
    @Body() body: SetPreferredVoiceDto,
  ) {
    return this.voiceService.setPreferredVoice(req.authUserData.userId, body);
  }

  // --- Get preferred voice ---
  @Get('preferred')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get preferred voice for the user' })
  async getPreferredVoice(
    @Req() req: AuthenticatedRequest,
  ): Promise<VoiceResponseDto | null> {
    return this.voiceService.getPreferredVoice(req.authUserData.userId);
  }

  // --- List available ElevenLabs voices ---
  @Get('available')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available ElevenLabs voices' })
  async listAvailableVoices(): Promise<any[]> {
    return this.storyService.fetchAvailableVoices(); // reuse method
  }

  // --- Text to Speech ---
  @Get('story/audio/:id')
  @ApiOperation({ summary: 'Generate audio for stored text using ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'voiceType', required: false, enum: VoiceType })
  @ApiResponse({ status: 200, description: 'Audio generated successfully' })
  async getTextToSpeechById(
    @Param('id') id: string,
    @Query('voiceType') voiceType?: VoiceType,
  ) {
    const audioUrl = await this.storyService.getStoryAudioUrl(
      id,
      voiceType ?? VoiceType.MILO,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceType: voiceType || VoiceType.MILO,
      statusCode: 200,
    };
  }

  @Post('story/audio')
  @ApiOperation({ summary: 'Convert raw text to speech and return audio URL' })
  @ApiResponse({ status: 200, description: 'Audio generated successfully' })
  @ApiBody({ type: StoryContentAudioDto })
  async textToSpeech(@Body() dto: StoryContentAudioDto) {
    const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
      randomUUID().toString(),
      dto.content,
      dto.voiceType ?? VoiceType.MILO,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceType: dto.voiceType || VoiceType.MILO,
      statusCode: 200,
    };
  }

  // --- Speech to Text ---
  @Post('transcribe')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Transcribe audio file to text' })
  async transcribeAudio(
    @UploadedFile() file: Express.Multer.File,
  ) {
    const text = await this.speechToTextService.transcribeAudio(
      file.buffer,
      file.mimetype,
    );
    return { text };
  }
}
