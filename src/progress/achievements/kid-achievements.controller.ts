import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { KidAchievementsService } from './kid-achievements.service';
import { AuthSessionGuard, AuthenticatedRequest } from '../../auth/auth.guard';

@ApiTags('Kid Achievements')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids/:kidId/progress')
export class KidAchievementsController {
  constructor(private readonly svc: KidAchievementsService) {}

  @Get('badges')
  @ApiOperation({ summary: 'List badges/achievements for a kid (age-aware)' })
  async list(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.svc.listAchievements(kidId, req.authUserData.userId);
  }
}
