import { Controller, Get, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { AuthSessionGuard, AuthenticatedRequest } from '../../auth/auth.guard';
import { KidAvatarService } from './kid-avatar.service';
import { UpdateKidAvatarDto } from './kid-avatar.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Kid Avatars')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/avatars/kid')
export class KidAvatarController {
  constructor(private readonly kidAvatarService: KidAvatarService) {}

  @Get(':kidId')
  @ApiOperation({ summary: 'Get avatar for a kid' })
  async getKidAvatar(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.kidAvatarService.getKidAvatar(kidId, req.authUserData.userId);
  }

  @Patch(':kidId')
  @ApiOperation({ summary: 'Update avatar for a kid' })
  async updateKidAvatar(
    @Param('kidId') kidId: string,
    @Body() dto: UpdateKidAvatarDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.kidAvatarService.updateKidAvatar(kidId, dto, req.authUserData.userId);
  }
}

