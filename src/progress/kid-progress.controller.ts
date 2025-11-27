import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KidProgressService } from './kid-progress.service';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';

@ApiTags('Kid Progress')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids')
export class KidProgressController {
  constructor(private readonly svc: KidProgressService) {}

  @Get(':kidId/progress')
  @ApiOperation({ summary: 'List all reading progress for a kid (age-aware)' })
  async list(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.svc.listProgress(kidId, req.authUserData.userId);
  }
}
