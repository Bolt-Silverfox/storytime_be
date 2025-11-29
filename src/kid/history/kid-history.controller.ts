import { Controller, Get, Param, Request, UseGuards, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { KidHistoryService } from './kid-history.service';
import { AuthSessionGuard, AuthenticatedRequest } from '../../auth/auth.guard';

@ApiTags('Kid History')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids/:kidId/history')
export class KidHistoryController {
  constructor(private readonly service: KidHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'Get reading history for a kid' })
  async getHistory(
    @Param('kidId') kidId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.getKidHistory(kidId, req.authUserData.userId);
  }


  @Delete(':storyId')
  @ApiOperation({ summary: 'Delete a single history entry for a kid' })
  @HttpCode(200)
  async deleteSingle(
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.svc.deleteSingle(kidId, storyId, req.authUserData.userId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear all reading history for a kid' })
  @HttpCode(200)
  async clearAll(
    @Param('kidId') kidId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.svc.clearAll(kidId, req.authUserData.userId);
  }


}
