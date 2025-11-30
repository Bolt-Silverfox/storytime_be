import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseArrayPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { KidService } from './kid.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';

@ApiTags('Kids Management')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller()
export class KidController {
    constructor(private readonly kidService: KidService) { }

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
        @Body(new ParseArrayPipe({ items: CreateKidDto })) dtos: CreateKidDto[]
    ) {
        return this.kidService.createKids(req.authUserData.userId, dtos);
    }

    @Get('/user/kids/:kidId')
    @ApiOperation({ summary: 'Get details of a specific kid' })
    async getKid(@Request() req: AuthenticatedRequest, @Param('kidId') kidId: string) {
        return this.kidService.findOne(kidId, req.authUserData.userId);
    }

    @Put('/auth/kids/:kidId')
    @ApiOperation({ summary: 'Update kid profile, preferences, bedtime, and voice' })
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
    async deleteKid(
        @Request() req: AuthenticatedRequest, 
        @Param('kidId') kidId: string,
        @Query('permanent') permanent: boolean = false
    ) {
        return this.kidService.deleteKid(kidId, req.authUserData.userId, permanent);
    }

    @Post('/auth/kids/:kidId/undo-delete')
    @ApiOperation({ summary: 'Restore a soft deleted kid profile' })
    async undoDeleteKid(
        @Request() req: AuthenticatedRequest,
        @Param('kidId') kidId: string
    ) {
        return this.kidService.undoDeleteKid(kidId, req.authUserData.userId);
    }
}