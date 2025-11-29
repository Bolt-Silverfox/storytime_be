import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KidAchievementsService } from './kid-achievements.service';
import { AuthSessionGuard, AuthenticatedRequest } from '@/auth/auth.guard';

@ApiTags('Kid Achievements')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids/:kidId/achievements')
export class KidAchievementsController {
  constructor(private readonly svc: KidAchievementsService) {}

  @Get()
  @ApiOperation({ summary: 'Get achievements / badges available to a kid (age filtered)' })
  async list(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.svc.getKidAchievements(kidId, req.authUserData.userId);
  }
}
