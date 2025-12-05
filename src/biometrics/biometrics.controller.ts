import { Controller, Post, Get, Body, Req, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';

import { BiometricsService } from './biometrics.service';
import { EnableBiometricsDto } from './dto/enable-biometrics.dto';
import { DisableBiometricsDto } from './dto/disable-biometrics.dto';

@ApiTags('biometrics')
@ApiBearerAuth()
@Controller('api/v1/biometrics')
@UseGuards(AuthSessionGuard)
export class BiometricsController {
  constructor(private readonly biometricsService: BiometricsService) {}

  @Post('enable')
  @ApiOperation({ summary: 'Enable biometrics for a device' })
  async enable(@Req() req: AuthenticatedRequest, @Body() body: EnableBiometricsDto) {
    return this.biometricsService.enableBiometrics(
      req.authUserData.userId,
      body.deviceId,
      body.hasBiometrics,
    );
  }

  @Post('disable')
  @ApiOperation({ summary: 'Disable biometrics for a device' })
  async disable(@Req() req: AuthenticatedRequest, @Body() body: DisableBiometricsDto) {
    return this.biometricsService.disableBiometrics(
      req.authUserData.userId,
      body.deviceId,
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Get biometrics status for a device' })
  async status(@Req() req: AuthenticatedRequest, @Query('deviceId') deviceId: string) {
    return this.biometricsService.biometricsStatus(
      req.authUserData.userId,
      deviceId,
    );
  }
}
