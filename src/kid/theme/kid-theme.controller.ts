import { Controller, Patch, Get, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { KidThemeService } from './kid-theme.service';
import { AuthSessionGuard, AuthenticatedRequest } from '@/auth/auth.guard';
import { UpdateKidThemeDto } from './dto/update-kid-theme.dto';

@ApiTags('Kid Theme')
@UseGuards(AuthSessionGuard)
@Controller('settings/kid')
export class KidThemeController {
  constructor(private svc: KidThemeService) {}

  @Get(':kidId/theme')
  @ApiOperation({ summary: 'Get kid theme' })
  async get(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.svc.getTheme(kidId, req.authUserData.userId);
  }

  @Patch(':kidId/theme')
  @ApiOperation({ summary: 'Update kid theme' })
  async update(@Param('kidId') kidId: string, @Body() body: UpdateKidThemeDto, @Request() req: AuthenticatedRequest) {
    return this.svc.updateTheme(kidId, body.theme, req.authUserData.userId);
  }
}

