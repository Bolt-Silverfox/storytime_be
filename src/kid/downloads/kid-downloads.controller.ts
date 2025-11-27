import { Controller, Get, Post, Delete, Body, Param, Request, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KidDownloadsService } from './kid-downloads.service';
import { AuthSessionGuard, AuthenticatedRequest } from '@/auth/auth.guard';
import { CreateKidDownloadDto } from './dto/create-kid-download.dto';

@ApiTags('Kid Downloads')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids/:kidId/downloads')
export class KidDownloadsController {
  constructor(private svc: KidDownloadsService) {}

  @Get()
  @ApiOperation({ summary: 'List downloads for a kid' })
  async list(
    @Param('kidId') kidId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.svc.list(kidId, req.authUserData.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a download for a kid' })
  async add(
    @Param('kidId') kidId: string,
    @Body() body: CreateKidDownloadDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.svc.add(kidId, body.storyId, req.authUserData.userId);
  }

  @Delete(':storyId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a kid download' })
  async remove(
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.svc.remove(kidId, storyId, req.authUserData.userId);
  }
}
