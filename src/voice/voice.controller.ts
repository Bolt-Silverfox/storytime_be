import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
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
import {
  ApiQueueTextSynthesis,
  ApiQueueStorySynthesis,
  ApiGetJobStatus,
  ApiGetJobResult,
  ApiCancelJob,
  ApiGetUserPendingJobs,
  ApiGetQueueStats,
} from './decorators';
import { randomUUID } from 'crypto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import {
  STORY_REPOSITORY,
  IStoryRepository,
} from '../story/repositories/story.repository.interface';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { DEFAULT_VOICE } from './voice.constants';
import {
  AsyncStorySynthesisDto,
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
import { VoiceQueueService, VoicePriority } from './queue';

@ApiTags('Voice')
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly speechToTextService: SpeechToTextService,
    private readonly voiceQuotaService: VoiceQuotaService,
    private readonly voiceQueueService: VoiceQueueService,
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
    const resolvedVoice = voiceId ?? DEFAULT_VOICE;
    const canUse = await this.voiceQuotaService.canUseVoice(
      req.authUserData.userId,
      resolvedVoice,
    );
    if (!canUse) {
      throw new ForbiddenException(
        'You do not have access to this voice. Upgrade to premium to unlock all voices.',
      );
    }

    const story = await this.storyRepository.findStoryById(id);
    if (!story) throw new NotFoundException('Story not found');

    const audioUrl = await this.textToSpeechService.synthesizeStory(
      story.id,
      story.textContent || story.description || '',
      resolvedVoice,
      req.authUserData.userId,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceId: resolvedVoice,
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
    const resolvedVoice = dto.voiceId ?? DEFAULT_VOICE;
    const canUse = await this.voiceQuotaService.canUseVoice(
      req.authUserData.userId,
      resolvedVoice,
    );
    if (!canUse) {
      throw new ForbiddenException(
        'You do not have access to this voice. Upgrade to premium to unlock all voices.',
      );
    }

    const audioUrl = await this.textToSpeechService.synthesizeStory(
      randomUUID().toString(),
      dto.content,
      resolvedVoice,
      req.authUserData.userId,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceId: resolvedVoice,
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

  // === ASYNC VOICE SYNTHESIS ENDPOINTS ===

  @Post('synthesize/async')
  @UseGuards(AuthSessionGuard)
  @ApiQueueTextSynthesis()
  async queueTextSynthesis(
    @Req() req: AuthenticatedRequest,
    @Body() dto: StoryContentAudioDto,
  ) {
    const userId = req.authUserData.userId;

    return this.voiceQueueService.queueTextSynthesis({
      userId,
      text: dto.content,
      voiceType: dto.voiceId as VoiceType | undefined,
      priority: VoicePriority.NORMAL,
      metadata: {
        clientIp: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  }

  @Post('synthesize/story/async')
  @UseGuards(AuthSessionGuard)
  @ApiQueueStorySynthesis()
  async queueStorySynthesis(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AsyncStorySynthesisDto,
  ) {
    const userId = req.authUserData.userId;

    return this.voiceQueueService.queueStorySynthesis({
      userId,
      storyId: dto.storyId,
      voiceType: dto.voiceId as VoiceType | undefined,
      updateStory: dto.updateStory,
      priority: VoicePriority.NORMAL,
      metadata: {
        clientIp: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  }

  @Get('synthesize/status/:jobId')
  @UseGuards(AuthSessionGuard)
  @ApiGetJobStatus()
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.voiceQueueService.getJobStatus(jobId);
  }

  @Get('synthesize/result/:jobId')
  @UseGuards(AuthSessionGuard)
  @ApiGetJobResult()
  async getJobResult(@Param('jobId') jobId: string) {
    return this.voiceQueueService.getJobResult(jobId);
  }

  @Delete('synthesize/job/:jobId')
  @UseGuards(AuthSessionGuard)
  @ApiCancelJob()
  async cancelJob(
    @Req() req: AuthenticatedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.voiceQueueService.cancelJob(jobId, req.authUserData.userId);
  }

  @Get('synthesize/pending')
  @UseGuards(AuthSessionGuard)
  @ApiGetUserPendingJobs()
  async getUserPendingJobs(@Req() req: AuthenticatedRequest) {
    return this.voiceQueueService.getUserPendingJobs(req.authUserData.userId);
  }

  @Get('synthesize/queue-stats')
  @UseGuards(AuthSessionGuard)
  @ApiGetQueueStats()
  async getQueueStats() {
    return this.voiceQueueService.getQueueStats();
  }
}
