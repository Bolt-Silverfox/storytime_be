import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { KidService } from './kid.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';

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
}