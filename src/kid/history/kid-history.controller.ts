import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
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
}
