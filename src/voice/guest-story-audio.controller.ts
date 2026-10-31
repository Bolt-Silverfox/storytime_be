import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '@/shared/decorators/public.decorator';
import { GUEST_AUDIO_THROTTLE } from '@/shared/constants/guest-audio.constants';
import { GuestStoryAudioService } from './guest-story-audio.service';
import { GuestStoryAudioDto } from './dto/guest-story-audio.dto';

/** Throttle tracker keyed by guest session (falls back to IP if absent). */
const guestSessionTracker = (req: Record<string, unknown>): Promise<string> => {
  const header = (req.headers as Record<string, unknown> | undefined)?.[
    'x-guest-session-id'
  ];
  const id = Array.isArray(header) ? header[0] : header;
  return Promise.resolve(
    typeof id === 'string' && id ? `guest-session:${id}` : (req.ip as string),
  );
};

const START = GUEST_AUDIO_THROTTLE.start;
const STATUS = GUEST_AUDIO_THROTTLE.status;

@ApiTags('Guest')
@Controller('guest/stories')
export class GuestStoryAudioController {
  constructor(private readonly audio: GuestStoryAudioService) {}

  @Post(':storyId/audio')
  @Public()
  @Throttle({
    short: { ...START.ipPerMinute },
    long: { ...START.perSession, getTracker: guestSessionTracker },
  })
  @ApiOperation({
    summary: 'Get/generate default-voice audio for a story a guest has opened',
    description:
      'Same response shape as POST /voice/story/audio/batch. The voice is ' +
      'always the default voice (any voiceId is ignored). Cached paragraphs ' +
      'are returned immediately; missing ones are generated (first few ' +
      'inline, the rest in the background: poll the status route).',
  })
  @ApiParam({ name: 'storyId', description: 'Story ID' })
  @ApiHeader({ name: 'x-guest-session-id', required: true })
  @ApiBody({ type: GuestStoryAudioDto, required: false })
  @ApiResponse({ status: 200, description: 'Paragraph audio (and batchJobId)' })
  @ApiResponse({ status: 400, description: 'Missing/invalid session header' })
  @ApiResponse({ status: 401, description: 'Guest session expired' })
  @ApiResponse({ status: 403, description: 'Story not opened by this session' })
  @ApiResponse({ status: 404, description: 'Story missing or unpublished' })
  @ApiResponse({ status: 429, description: 'Throttled' })
  startAudio(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    // Validated (so clients may keep sending voiceId) but never forwarded.
    @Body() _dto: GuestStoryAudioDto,
    @Headers('x-guest-session-id') guestSessionId?: string,
    @Req() req?: { ip?: string },
  ) {
    return this.audio.start(storyId, guestSessionId, req?.ip);
  }

  @Get(':storyId/audio/:batchJobId')
  @Public()
  // The default `medium` (50 req / 10 s per IP) would throttle shared-IP
  // polling (every client polls every ~2 s); this route is governed by its own
  // short (per-IP/min) and long (per-session) limits below.
  @SkipThrottle({ medium: true })
  @Throttle({
    short: { ...STATUS.ipPerMinute },
    long: { ...STATUS.perSession, getTracker: guestSessionTracker },
  })
  @ApiOperation({ summary: 'Poll background guest audio generation' })
  @ApiParam({ name: 'storyId', description: 'Story ID' })
  @ApiParam({ name: 'batchJobId', description: 'Batch job ID from the POST' })
  @ApiHeader({ name: 'x-guest-session-id', required: true })
  @ApiResponse({
    status: 200,
    description: 'Batch status with completed paragraphs',
  })
  @ApiResponse({
    status: 404,
    description: 'Batch not found, expired or not yours',
  })
  @ApiResponse({ status: 429, description: 'Throttled' })
  getAudioStatus(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Param('batchJobId', ParseUUIDPipe) batchJobId: string,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    return this.audio.status(storyId, batchJobId, guestSessionId);
  }
}
