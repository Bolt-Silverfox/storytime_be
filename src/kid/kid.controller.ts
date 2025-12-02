import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseArrayPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { KidService } from './kid.service';
import { CreateKidDto, UpdateKidDto, KidResponseDto } from './dto/kid.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { AnalyticsService } from '../analytics/analytics.service';

@ApiTags('Kids Management')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller()
export class KidController {
    constructor(
        private readonly kidService: KidService,
        private readonly analyticsService: AnalyticsService
    ) { }

    @Get('/auth/kids')
    @ApiOperation({ summary: 'Get all kids for the logged-in user' })
    @ApiResponse({ status: 200, description: 'List of kids retrieved successfully.', type: [KidResponseDto] })
    async getMyKids(@Request() req: AuthenticatedRequest) {
        return this.kidService.findAllByUser(req.authUserData.userId);
    }

    @Post('/auth/kids')
    @ApiOperation({ summary: 'Add one or more kids' })
    @ApiBody({ type: [CreateKidDto] })
    @ApiResponse({ status: 201, description: 'Kids created successfully.', type: [KidResponseDto] })
    async createKids(
        @Request() req: AuthenticatedRequest,
        @Body(new ParseArrayPipe({ items: CreateKidDto })) dtos: CreateKidDto[]
    ) {
        return this.kidService.createKids(req.authUserData.userId, dtos);
    }

    @Get('/user/kids/:kidId')
    @ApiOperation({ summary: 'Get details of a specific kid' })
    @ApiResponse({ status: 200, description: 'Kid details retrieved successfully.', type: KidResponseDto })
    async getKid(
        @Request() req: AuthenticatedRequest, 
        @Param('kidId') kidId: string
    ){  
        // Get the kid details first
        const kid = await this.kidService.findOne(kidId, req.authUserData.userId);
        
        // Extract device information from the request
        // This captures IP address, device name, OS, etc.
        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        
        // Parse User-Agent to get device details
        const UAParser = require('ua-parser-js');
        const parser = new UAParser(req.headers['user-agent'] as string);
        const ua = parser.getResult();
        
        // Log the activity with full device information
        // This runs in the background and doesn't block the response
        this.analyticsService.logActivity({
            userId: req.authUserData.userId,
            kidId: kidId,
            action: 'ACCESS_KID_ACCOUNT',
            status: 'SUCCESS',
            details: `Parent accessed kid account from home page`,
            ipAddress: ip as string,
            deviceName: ua.device.model || ua.browser.name || 'unknown',
            deviceModel: ua.device.vendor || 'unknown',
            os: `${ua.os.name || 'unknown'} ${ua.os.version || ''}`.trim(),
        }).catch(err => {
            // Silently catch errors so logging failures don't affect user experience
            console.error('Failed to log activity:', err);
        });
        
        return kid;
    }

    @Put('/auth/kids/:kidId')
    @ApiOperation({ summary: 'Update kid profile, preferences, bedtime, and voice' })
    @ApiResponse({ status: 200, description: 'Kid updated successfully.', type: KidResponseDto })
    async updateKid(@Request() req: AuthenticatedRequest, @Param('kidId') kidId: string, @Body() dto: UpdateKidDto) {
        return this.kidService.updateKid(kidId, req.authUserData.userId, dto);
    }

    @Delete('/auth/kids/:kidId')
    @ApiOperation({ summary: 'Delete a kid profile' })
    @ApiQuery({
        name: 'permanent',
        required: false,
        type: Boolean,
        description: 'Permanently delete the kid profile (default: false - soft delete)'
    })
    @ApiResponse({ status: 200, description: 'Kid deleted successfully.' })
    async deleteKid(
        @Request() req: AuthenticatedRequest, 
        @Param('kidId') kidId: string,
        @Query('permanent') permanent: boolean = false
    ) {
        return this.kidService.deleteKid(kidId, req.authUserData.userId, permanent);
    }

    @Post('/auth/kids/:kidId/undo-delete')
    @ApiOperation({ summary: 'Restore a soft deleted kid profile' })
    @ApiResponse({ status: 200, description: 'Kid restored successfully.', type: KidResponseDto })
    async undoDeleteKid(
        @Request() req: AuthenticatedRequest,
        @Param('kidId') kidId: string
    ) {
        return this.kidService.undoDeleteKid(kidId, req.authUserData.userId);
    }
}