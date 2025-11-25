import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Patch, BadRequestException, ForbiddenException, ParseArrayPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { KidService } from './kid.service';
import { CreateKidDto, UpdateKidDto, SetKidPreferredVoiceDto, KidVoiceDto } from './dto/kid.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { VoiceType, VOICEID } from '@/story/story.dto';

@ApiTags('Kids Management')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller()
export class KidController {
    constructor(private readonly kidService: KidService) { }

    // 1. GET /auth/kids (Get all kids)
    @Get('auth/kids')
    @ApiOperation({ summary: 'Get all kids for the logged-in user' })
    async getMyKids(@Request() req: AuthenticatedRequest) {
        return this.kidService.findAllByUser(req.authUserData.userId);
    }

    // 2. POST /auth/kids (Add a kid)
    @Post('auth/kids')
    @ApiOperation({ summary: 'Add a new kid' })
    async createKid(@Request() req: AuthenticatedRequest, @Body() dto: CreateKidDto) {
        return this.kidService.createKid(req.authUserData.userId, dto);
    }

    // 3. GET /user/kids/:kidId (Get child by ID)
    @Get('user/kids/:kidId')
    @ApiOperation({ summary: 'Get details of a specific kid' })
    async getKid(@Request() req: AuthenticatedRequest, @Param('kidId') kidId: string) {
        return this.kidService.findOne(kidId, req.authUserData.userId);
    }

    // 4. PUT /auth/kids/:kidId (Update profile)
    @Put('auth/kids/:kidId')
    @ApiOperation({ summary: 'Update kid profile, preferences, and bedtime' })
    async updateKid(@Request() req: AuthenticatedRequest, @Param('kidId') kidId: string, @Body() dto: UpdateKidDto) {
        return this.kidService.updateKid(kidId, req.authUserData.userId, dto);
    }

    // 5. DELETE /auth/kids/:kidId (Delete profile)
    @Delete('auth/kids/:kidId')
    @ApiOperation({ summary: 'Delete a kid profile' })
    async deleteKid(@Request() req: AuthenticatedRequest, @Param('kidId') kidId: string) {
        return this.kidService.deleteKid(kidId, req.authUserData.userId);
    }

    // 6. PATCH /user/kids/:kidId/voice (Set preferred voice)
    @Patch('user/kids/:kidId/voice')
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
        return this.kidService.setKidPreferredVoice(kidId, voiceKey as VoiceType);
    }

    // 7. GET /user/kids/:kidId/voice (Get preferred voice)
    @Get('user/kids/:kidId/voice')
    @ApiOperation({ summary: 'Get preferred voice for a kid' })
    @ApiResponse({ status: 200, type: KidVoiceDto })
    async getKidPreferredVoice(@Param('kidId') kidId: string) {
        return await this.kidService.getKidPreferredVoice(kidId);
    }
    @Post('auth/kids/bulk')
    @ApiOperation({ summary: 'Add multiple kids at once' })
    @ApiBody({ type: [CreateKidDto] })
    async createKids(
        @Request() req: AuthenticatedRequest,
        @Body(new ParseArrayPipe({ items: CreateKidDto })) dtos: CreateKidDto[],
    ) {
        return this.kidService.createKids(req.authUserData.userId, dtos);
    }
}