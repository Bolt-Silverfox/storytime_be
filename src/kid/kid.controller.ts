import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ParseArrayPipe,
  Patch,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';

import { KidService } from './kid.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { VoiceType, VOICEID } from '@/story/story.dto';
import { UpdateKidProfileDto } from './dto/update-kid-profile.dto';

// Kid voice DTOs
import {
  SetKidPreferredVoiceDto,
  KidVoiceDto,
} from './dto/kid-voice.dto';

@ApiTags('Kids Management')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller()
export class KidController {
  constructor(private readonly kidService: KidService) {}

  @Get('/auth/kids')
  @ApiOperation({ summary: 'Get all kids for the logged-in user' })
  async getMyKids(@Request() req: AuthenticatedRequest) {
    return this.kidService.findAllByUser(req.authUserData.userId);
  }

  @Post('/auth/kids')
  @ApiOperation({ summary: 'Add one or more kids' })
  @ApiBody({ type: [CreateKidDto] })
  async createKids(
    @Request() req: AuthenticatedRequest,
    @Body(new ParseArrayPipe({ items: CreateKidDto })) dtos: CreateKidDto[],
  ) {
    return this.kidService.createKids(req.authUserData.userId, dtos);
  }

  @Get('/user/kids/:kidId')
  @ApiOperation({ summary: 'Get details of a specific kid' })
  async getKid(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    return this.kidService.findOne(kidId, req.authUserData.userId);
  }

  @Put('/auth/kids/:kidId')
  @ApiOperation({
    summary: 'Update kid profile, preferences, bedtime, and voice',
  })
  async updateKid(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Body() dto: UpdateKidDto,
  ) {
    return this.kidService.updateKid(kidId, req.authUserData.userId, dto);
  }

  @Delete('/auth/kids/:kidId')
  @ApiOperation({ summary: 'Delete a kid profile' })
  async deleteKid(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    return this.kidService.deleteKid(kidId, req.authUserData.userId);
  }

  // -----------------------------
  // SET KID PREFERRED VOICE
  // -----------------------------
  @Patch('/user/kids/:kidId/voice')
  @ApiOperation({ summary: 'Set preferred voice for a kid' })
  @ApiBody({ type: SetKidPreferredVoiceDto })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async setKidPreferredVoice(
    @Param('kidId') kidId: string,
    @Body() body: SetKidPreferredVoiceDto,
  ) {
    if (!body.voiceType) {
      throw new BadRequestException('Voice type is required');
    }

    const voiceKey = body.voiceType.toUpperCase() as keyof typeof VOICEID;
    const voiceId = VOICEID[voiceKey];

    if (!voiceId) {
      throw new ForbiddenException('Invalid voice type');
    }

    return this.kidService.setKidPreferredVoice(
      kidId,
      voiceKey as VoiceType,
    );
  }

  // -----------------------------
  // GET KID PREFERRED VOICE
  // -----------------------------
  @Get('/user/kids/:kidId/voice')
  @ApiOperation({ summary: 'Get preferred voice for a kid' })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async getKidPreferredVoice(@Param('kidId') kidId: string) {
    return this.kidService.getKidPreferredVoice(kidId);
  }

  // -----------------------------
  // UPDATE KID BASE PROFILE
  // -----------------------------
  @Put('api/v1/kids/:kidId/profile')
  @ApiOperation({ summary: 'Update kid base profile' })
  async updateKidProfile(
    @Param('kidId') kidId: string,
    @Body() dto: UpdateKidProfileDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.kidService.updateKid(kidId, req.authUserData.userId, dto);
  }
}
