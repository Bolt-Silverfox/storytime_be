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
  ParseFilePipeBuilder,
  HttpStatus,
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
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { StoryService } from '../story/story.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { DEFAULT_VOICE } from './voice.constants';
import {
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  StoryContentAudioDto,
  UploadVoiceDto,
  VoiceResponseDto,
  VoiceType,
} from './dto/voice.dto';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceService } from './voice.service';
import { VoiceQuotaService } from './voice-quota.service';

@ApiTags('Voice')
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly storyService: StoryService,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly speechToTextService: SpeechToTextService,
    private readonly voiceQuotaService: VoiceQuotaService,
  ) {}

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
      file.buffer,
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
  ): Promise<VoiceResponseDto> {
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

  // --- Free tier second voice selection ---
  @Patch('second-voice')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set second voice for free tier user',
    description:
      'Free users can select one additional voice beyond the default. Premium users have unlimited access.',
  })
  @ApiBody({ type: SetPreferredVoiceDto })
  @ApiResponse({ status: 200, description: 'Second voice set successfully' })
  @ApiResponse({
    status: 400,
    description: 'Premium users do not need to set a second voice',
  })
  @ApiResponse({ status: 404, description: 'Voice not found' })
  async setSecondVoice(
    @Req() req: AuthenticatedRequest,
    @Body() body: SetPreferredVoiceDto,
  ) {
    await this.voiceQuotaService.setSecondVoice(
      req.authUserData.userId,
      body.voiceId,
    );
    return { message: 'Second voice set successfully', voiceId: body.voiceId };
  }

  // --- Get voice access status ---
  @Get('access')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get voice access status for the user',
    description:
      'Returns information about which voices the user can access based on their subscription tier.',
  })
  @ApiResponse({
    status: 200,
    description: 'Voice access status',
    schema: {
      type: 'object',
      properties: {
        isPremium: { type: 'boolean' },
        unlimited: { type: 'boolean' },
        defaultVoice: { type: 'string' },
        selectedSecondVoice: { type: 'string', nullable: true },
        maxVoices: { type: 'number' },
      },
    },
  })
  async getVoiceAccess(@Req() req: AuthenticatedRequest) {
    return this.voiceQuotaService.getVoiceAccess(req.authUserData.userId);
  }

  // --- List available ElevenLabs voices ---
  @Get('available')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available ElevenLabs voices' })
  async listAvailableVoices(): Promise<VoiceResponseDto[]> {
    return this.voiceService.fetchAvailableVoices();
  }

  // --- Text to Speech ---
  @Get('story/audio/:id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate audio for stored text using ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({
    name: 'voiceId',
    required: false,
    type: String,
    description: 'VoiceType enum value or Voice UUID',
  })
  @ApiResponse({ status: 200, description: 'Audio generated successfully' })
  async getTextToSpeechById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('voiceId') voiceId?: VoiceType | string,
  ) {
    const audioUrl = await this.storyService.getStoryAudioUrl(
      id,
      voiceId ?? DEFAULT_VOICE,
      req.authUserData.userId,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceId: voiceId || DEFAULT_VOICE,
      statusCode: 200,
    };
  }

  @Post('story/audio')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Convert raw text to speech and return audio URL' })
  @ApiResponse({ status: 200, description: 'Audio generated successfully' })
  @ApiBody({ type: StoryContentAudioDto })
  async textToSpeech(
    @Body() dto: StoryContentAudioDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
      randomUUID().toString(),
      dto.content,
      dto.voiceId ?? DEFAULT_VOICE,
      req.authUserData.userId,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceId: dto.voiceId || DEFAULT_VOICE,
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
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType:
            /(audio\/mpeg|audio\/wav|audio\/x-m4a|audio\/ogg|audio\/webm)/,
        })
        .addMaxSizeValidator({
          maxSize: 50 * 1024 * 1024, // 50MB
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
  ) {
    const text = await this.speechToTextService.transcribeAudio(
      file.buffer,
      file.mimetype,
    );
    return { text };
  }
}
