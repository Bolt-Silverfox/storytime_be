import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { VoiceService } from './voice.service';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { VoiceResponseDto } from '../story/story.dto';

@ApiTags('Voices')
@Controller('voices')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) { }

  @Get()
  @ApiOperation({ summary: 'Get all available voices (System + User Custom)' })
  @ApiResponse({ status: 200, type: [VoiceResponseDto] })
  async getVoices(@Request() req: AuthenticatedRequest) {
    return this.voiceService.getAllAvailableVoices(req.authUserData.userId);
  }
}