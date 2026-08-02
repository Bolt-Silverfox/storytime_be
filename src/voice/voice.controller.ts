import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { OptionalAuth } from '@/shared/decorators/optional-auth.decorator';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { GuestSessionService } from '@/guest/guest-session.service';
import { StoryQuotaService } from '../story/story-quota.service';
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
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import { EAGER_PARAGRAPH_COUNT } from './queue/tts-batch-queue.constants';

@ApiTags('Voice')
@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  /**
   * Resolves the user ID from the request, preferring authenticated users
   * and falling back to guest session ID.
   * @throws BadRequestException if required credentials are missing
   */
  private resolveRequesterUserId(
    req: AuthenticatedRequest,
    guestSessionId?: string,
  ): { userId: string; isGuest: boolean } {
    const isGuest = !req.authUserData;
    let userId: string;

    if (isGuest) {
      if (!guestSessionId) {
        throw new BadRequestException(
          'x-guest-session-id header is required for guest requests',
        );
      }
      userId = guestSessionId;
    } else {
      if (!req.authUserData?.userId) {
        throw new BadRequestException('Authenticated user missing userId');
      }
      userId = req.authUserData.userId;
    }

    return { userId, isGuest };
  }

  constructor(
    private readonly voiceService: VoiceService,
    private readonly storyService: StoryService,
    private readonly storyQuotaService: StoryQuotaService,
    private readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly speechToTextService: SpeechToTextService,
    private readonly voiceQuotaService: VoiceQuotaService,
    private readonly ttsBatchQueueService: TtsBatchQueueService,
    private readonly guestSessionService: GuestSessionService,
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
            /^(audio\/mpeg|audio\/wav|audio\/x-m4a|audio\/m4a|audio\/mp4|audio\/ogg|audio\/webm)$/,
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

    // Lock voice for free users who haven't locked one yet.
    // Must happen before setPreferredVoice to prevent out-of-sync state.
    if (!access.isPremium && !access.lockedVoiceId) {
      const locked = await this.voiceQuotaService.lockFreeUserVoice(
        userId,
        body.voiceId,
      );
      if (!locked) {
        throw new ForbiddenException(
          'Unable to lock voice selection. Please try again.',
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
  @OptionalAuth()
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
        usedVoicesForStory: {
          type: 'array',
          items: { type: 'string' },
          description:
            'VoiceType keys already used on the given story (premium only)',
        },
        maxVoicesPerStory: {
          type: 'number',
          description: 'Max distinct voices allowed per story for premium',
        },
      },
    },
  })
  @ApiQuery({
    name: 'storyId',
    required: false,
    type: String,
    description: 'Optional story ID to retrieve per-story voice usage',
  })
  async getVoiceAccess(
    @Req() req: AuthenticatedRequest,
    @Query('storyId') storyId?: string,
  ) {
    const userId = req.authUserData?.userId;

    // For guests, return default access info before any DB lookups
    if (!userId) {
      return {
        isPremium: false,
        unlimited: false,
        defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
        maxVoices: 1,
        lockedVoiceId: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
        elevenLabsTrialStoryId: null,
        usedVoicesForStory: [],
        maxVoicesPerStory: 1,
      };
    }

    if (storyId) {
      const story = await this.storyService.getStoryById(storyId);
      if (!story) {
        throw new NotFoundException(`Story ${storyId} not found`);
      }
    }
    return this.voiceQuotaService.getVoiceAccess(userId, storyId);
  }

  // --- List available ElevenLabs voices ---
  @Get('available')
  @OptionalAuth()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available ElevenLabs voices' })
  async listAvailableVoices(): Promise<VoiceResponseDto[]> {
    return this.voiceService.fetchAvailableVoices();
  }

  // --- Text to Speech ---

  @Post('story/audio/batch')
  @OptionalAuth()
  @UseGuards(AuthSessionGuard)
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
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
        outline: {
          type: 'array',
          description:
            'Every paragraph in reading order (ready AND pending), so a reader ' +
            'can render per-paragraph text up-front and sync it to audio that ' +
            'arrives later over SSE. Audio is NOT included here.',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              text: { type: 'string' },
            },
          },
        },
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
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    const { userId, isGuest } = this.resolveRequesterUserId(
      req,
      guestSessionId,
    );

    const resolvedVoice = dto.voiceId ?? DEFAULT_VOICE;

    if (isGuest) {
      // Guests may only use the default voice; compare canonical IDs so
      // aliases of the default voice are accepted.
      const defaultCanonical =
        await this.voiceQuotaService.resolveCanonicalVoiceId(DEFAULT_VOICE);
      const requestedCanonical = dto.voiceId
        ? await this.voiceQuotaService.resolveCanonicalVoiceId(dto.voiceId)
        : defaultCanonical;

      if (requestedCanonical !== defaultCanonical) {
        this.logger.warn(
          `Guest user tried to use voice: ${dto.voiceId} (canonical: ${requestedCanonical}), only ${DEFAULT_VOICE} allowed`,
        );
        throw new ForbiddenException(
          'Guest users can only use the default voice. Sign in to access all voices.',
        );
      }

      // Validate guest session existence before loading the story
      const session = await this.guestSessionService.getGuestSession(userId);
      if (!session) {
        throw new UnauthorizedException('Invalid or expired guest session');
      }
    } else {
      const canUse = await this.voiceQuotaService.canUseVoice(
        userId,
        resolvedVoice,
      );
      if (!canUse) {
        throw new ForbiddenException(
          'You do not have access to this voice. Upgrade to premium to unlock all voices.',
        );
      }
    }

    const story = await this.storyService.getStoryById(dto.storyId);
    if (!story || !story.textContent) {
      throw new NotFoundException('Story not found or has no content.');
    }

    // Story quota check for authenticated users
    if (!isGuest) {
      const storyAccess = await this.storyQuotaService.checkStoryAccess(
        userId,
        dto.storyId,
      );
      if (!storyAccess.canAccess) {
        throw new ForbiddenException(
          'You have reached your story limit. Upgrade to premium for unlimited stories!',
        );
      }
      if (
        storyAccess.reason !== 'already_read' &&
        storyAccess.reason !== 'premium' &&
        storyAccess.reason !== 'kid_created'
      ) {
        await this.storyQuotaService.recordNewStoryAccess(userId, dto.storyId);
      }
    }

    // Guest access validation: check session, story, and quota atomically
    if (isGuest) {
      const accessResult = await this.guestSessionService.recordNewStoryAccess(
        userId,
        dto.storyId,
      );
      if (!accessResult.recorded) {
        if (accessResult.reason === 'session_not_found') {
          throw new UnauthorizedException('Invalid or expired guest session');
        }
        if (accessResult.reason === 'quota_exceeded') {
          throw new ForbiddenException(
            'You have reached your story limit. Sign up to continue reading!',
          );
        }
        // 'already_read' → proceed
      }
    }

    const {
      results: paragraphs,
      totalParagraphs,
      wasTruncated,
      usedProvider,
      preferredProvider,
      providerStatus,
      remainingUncached,
      batchProvider,
      isPremium,
    } = await this.textToSpeechService.batchTextToSpeechEager(
      dto.storyId,
      story.textContent,
      resolvedVoice,
      isGuest ? undefined : userId,
      EAGER_PARAGRAPH_COUNT,
    );

    // If there are remaining uncached paragraphs, queue them for background generation
    let batchJobId: string | undefined;
    let pendingParagraphs: number | undefined;

    if (remainingUncached.length > 0) {
      try {
        batchJobId = await this.ttsBatchQueueService.queueBatch({
          storyId: dto.storyId,
          voiceId: resolvedVoice,
          userId,
          isPremium: isGuest ? false : isPremium,
          provider: batchProvider,
          paragraphs: remainingUncached,
          totalParagraphs,
        });
        pendingParagraphs = remainingUncached.length;
      } catch (error) {
        this.logger.error(
          `Failed to queue TTS batch for story ${dto.storyId}: ${(error as Error).message}`,
        );
        // Return eager results without batchJobId — client gets usable audio instead of 500
      }
    }

    // Full reading-order outline (ready + pending), deduped by index. Lets a
    // reader lay out every paragraph's text immediately and light up audio per
    // index as it streams in over SSE, keeping text and narration in sync.
    const textByIndex = new Map<number, string>();
    for (const p of paragraphs) {
      if (typeof p.text === 'string') textByIndex.set(p.index, p.text);
    }
    for (const p of remainingUncached) {
      if (!textByIndex.has(p.index)) textByIndex.set(p.index, p.text);
    }
    const outline = [...textByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, text]) => ({ index, text }));

    return {
      message: 'Batch audio generated successfully',
      paragraphs,
      totalParagraphs,
      outline,
      wasTruncated,
      voiceId: resolvedVoice,
      usedProvider,
      ...(preferredProvider ? { preferredProvider } : {}),
      ...(providerStatus ? { providerStatus } : {}),
      ...(batchJobId ? { batchJobId } : {}),
      ...(pendingParagraphs !== undefined ? { pendingParagraphs } : {}),
      statusCode: 200,
    };
  }

  @Get('story/audio/batch/status/:batchJobId')
  @OptionalAuth()
  @UseGuards(AuthSessionGuard)
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Poll status of background TTS batch generation' })
  @ApiResponse({
    status: 200,
    description: 'Batch status with completed paragraphs',
  })
  @ApiResponse({ status: 404, description: 'Batch not found or expired' })
  async getBatchStatus(
    @Param('batchJobId', ParseUUIDPipe) batchJobId: string,
    @Req() req: AuthenticatedRequest,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    const { userId } = this.resolveRequesterUserId(req, guestSessionId);

    const status = await this.ttsBatchQueueService.getBatchStatus(
      batchJobId,
      userId,
    );

    if (!status) {
      throw new NotFoundException(
        'Batch not found or expired. Completed paragraphs remain usable.',
      );
    }

    return status;
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
            /^(audio\/mpeg|audio\/wav|audio\/x-m4a|audio\/m4a|audio\/mp4|audio\/ogg|audio\/webm)$/,
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
