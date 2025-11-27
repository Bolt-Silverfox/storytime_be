import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { KidStreakService } from './kid-streak.service';
import { AuthSessionGuard, AuthenticatedRequest } from '../../auth/auth.guard';

@ApiTags('Kid Streak')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids/:kidId/progress')
export class KidStreakController {
  constructor(private readonly svc: KidStreakService) {}

  @Get('streak')
  @ApiOperation({ summary: 'Get current & longest streak for a kid (age-aware)' })
  async streak(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.svc.getCurrentStreak(kidId, req.authUserData.userId);
  }
}

