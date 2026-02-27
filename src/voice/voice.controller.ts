import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  Post,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { StoryService } from '../story/story.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { DEFAULT_VOICE } from './voice.constants';
import {
  BatchStoryAudioDto,
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
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
    private readonly uploadService: UploadService,
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
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType:
            /(audio\/mpeg|audio\/wav|audio\/x-m4a|audio\/ogg|audio\/webm)/,
        })
        .addMaxSizeValidator({
          maxSize: 25 * 1024 * 1024, // 25MB
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
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
    const userId = req.authUserData.userId;
    const access = await this.voiceQuotaService.getVoiceAccess(userId);

    if (!access.isPremium && access.lockedVoiceId) {
      // Canonicalize both sides to ElevenLabs IDs so VoiceType keys,
      // UUIDs, and migrated names all compare correctly.
      const lockedCanonical =
        await this.voiceQuotaService.resolveCanonicalVoiceId(
          access.lockedVoiceId,
        );
      const requestedCanonical =
        await this.voiceQuotaService.resolveCanonicalVoiceId(body.voiceId);

      if (lockedCanonical !== requestedCanonical) {
        throw new ForbiddenException(
          'Free users cannot change their voice after selecting one. Upgrade to premium to unlock all voices.',
        );
      }
    }

    return this.voiceService.setPreferredVoice(userId, body);
  }

  // --- Get preferred voice ---
  @Get('preferred')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get preferred voice for the user' })
  async getPreferredVoice(
    @Req() req: AuthenticatedRequest,
  ): Promise<VoiceResponseDto> {
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
        maxVoices: { type: 'number' },
        lockedVoiceId: { type: 'string', nullable: true },
        elevenLabsTrialStoryId: { type: 'string', nullable: true },
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

  @Post('story/audio/batch')
  @UseGuards(AuthSessionGuard)
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate audio for all paragraphs of a story' })
  @ApiResponse({
    status: 200,
    description: 'Batch audio generated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        paragraphs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              text: { type: 'string' },
              audioUrl: { type: 'string', nullable: true },
            },
          },
        },
        totalParagraphs: { type: 'number' },
        wasTruncated: { type: 'boolean' },
        voiceId: { type: 'string' },
        usedProvider: {
          type: 'string',
          enum: ['elevenlabs', 'deepgram', 'edgetts', 'none'],
          description:
            'The TTS provider that generated the audio. "none" when text is empty.',
        },
        preferredProvider: {
          type: 'string',
          enum: ['elevenlabs', 'deepgram', 'edgetts'],
          nullable: true,
          description:
            'The originally preferred provider (present only when a fallback occurred)',
        },
        providerStatus: {
          type: 'string',
          enum: ['degraded'],
          nullable: true,
          description: 'Present when a TTS provider circuit breaker is open',
        },
        statusCode: { type: 'number' },
      },
    },
  })
  @ApiBody({ type: BatchStoryAudioDto })
  async batchTextToSpeech(
    @Body() dto: BatchStoryAudioDto,
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

    const story = await this.storyService.getStoryById(dto.storyId);
    if (!story || !story.textContent) {
      throw new NotFoundException('Story not found or has no content.');
    }

    const {
      results: paragraphs,
      totalParagraphs,
      wasTruncated,
      usedProvider,
      preferredProvider,
      providerStatus,
    } = await this.textToSpeechService.batchTextToSpeechCloudUrls(
      dto.storyId,
      story.textContent,
      resolvedVoice,
      req.authUserData.userId,
    );

    return {
      message: 'Batch audio generated successfully',
      paragraphs,
      totalParagraphs,
      wasTruncated,
      voiceId: resolvedVoice,
      usedProvider,
      ...(preferredProvider ? { preferredProvider } : {}),
      ...(providerStatus ? { providerStatus } : {}),
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
