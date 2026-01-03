import { Controller, Post, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { BiometricsService } from './biometrics.service';

@ApiTags('biometrics')
@ApiBearerAuth()
@Controller('biometrics')
@UseGuards(AuthSessionGuard)
export class BiometricsController {
  constructor(private readonly biometricsService: BiometricsService) { }

  @Post('enable')
  @ApiOperation({ summary: 'Enable biometrics for user' })
  async enable(@Req() req: AuthenticatedRequest) {
    return this.biometricsService.enableBiometrics(req.authUserData.userId);
  }

  @Post('disable')
  @ApiOperation({ summary: 'Disable biometrics for user' })
  async disable(@Req() req: AuthenticatedRequest) {
    return this.biometricsService.disableBiometrics(req.authUserData.userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get biometrics status for user' })
  async status(@Req() req: AuthenticatedRequest) {
    return this.biometricsService.biometricsStatus(req.authUserData.userId);
  }
}
