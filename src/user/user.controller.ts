import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
  Delete,
  ForbiddenException,
  Patch,
  BadRequestException,
  Logger,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { AuthSessionGuard } from '../auth/auth.guard';
import { UserDto } from '../auth/auth.dto';
import { UpdateUserDto } from './dto/user.dto';

import { UpdateParentProfileDto } from './dto/update-parent-profile.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { EnableBiometricsDto } from './dto/enable-biometrics.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { ResetPinDto } from './dto/reset-pin.dto';
import { ParentProfileResponseDto } from './dto/parent-profile-response.dto';
import { mapParentProfile } from './utils/parent-profile.mapper';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { SupportTicketResponseDto } from './dto/support-ticket-response.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

export enum UserRole {
  ADMIN = 'admin',
  PARENT = 'parent',
  KID = 'kid',
}

class UpdateUserRoleDto {
  role: UserRole;
}

@ApiTags('user')
@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  // ============================================================
  //                     KID ENDPOINTS
  // ============================================================
  @Get('kids/:kidId')
  @ApiOperation({ summary: 'Get kid by ID' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200 })
  async getKidById(@Param('kidId') kidId: string) {
    try {
      return await this.userService.getKidById(kidId);
    } catch (error) {
      this.logger.error(`Error fetching kid ${kidId}: ${error.message}`);
      throw error;
    }
  }

  // ============================================================
  //                 SELF / PARENT PROFILE ENDPOINTS
  // ============================================================

  @Get('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: ParentProfileResponseDto })
  async getMe(@Req() req: any) {
    const raw = await this.userService.getUser(req.authUserData.userId);
    return mapParentProfile(raw);
  }

  @Patch('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update parent profile' })
  async updateMyProfile(@Req() req: any, @Body() body: UpdateParentProfileDto) {
    return this.userService.updateParentProfile(req.authUserData.userId, body);
  }

  @Post('me/avatar')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update parent avatar' })
  async updateAvatar(@Req() req: any, @Body() body: UpdateAvatarDto) {
    return this.userService.updateAvatarForParent(req.authUserData.userId, body);
  }

  @Post('me/biometrics')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable biometrics' })
  async setBiometrics(@Req() req: any, @Body() body: EnableBiometricsDto) {
    return this.userService.setBiometrics(req.authUserData.userId, body.enable);
  }

  @Post('me/pin')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update PIN' })
  async setPin(@Req() req: any, @Body() body: SetPinDto) {
    return this.userService.setPin(req.authUserData.userId, body.pin);
  }

  @Post('me/pin/verify')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify PIN' })
  async verifyPin(@Req() req: any, @Body() body: SetPinDto) {
    return this.userService.verifyPin(req.authUserData.userId, body.pin);
  }

  @Post('me/pin/reset')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset existing PIN' })
  async resetPin(@Req() req: any, @Body() body: ResetPinDto) {
    if (body.newPin !== body.confirmNewPin) {
      throw new BadRequestException('New PIN and confirmation do not match');
    }
    return this.userService.resetPin(
      req.authUserData.userId,
      body.oldPin,
      body.newPin,
    );
  }

  @Delete('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete my account' })
  async deleteMe(@Req() req: any) {
    return this.userService.deleteUserAccount(req.authUserData.userId);
  }

  @Post('me/delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request account deletion (verify password + reasons)' })
  async deleteAccountWithConfirmation(
    @Req() req: any,
    @Body() body: DeleteAccountDto,
  ) {
    return this.userService.deleteAccountWithConfirmation(
      req.authUserData.userId,
      body.password,
      body.reasons,
      body.notes,
    );
  }

  // ============================================================
  //                       ADMIN + GENERIC ROUTES
  // ============================================================

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all users (admin only)' })
  async getAllUsers(@Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.getAllUsers();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiParam({ name: 'id', type: String })
  async getUser(@Param('id') id: string) {
    const user = await this.userService.getUser(id);
    return user ? new UserDto(user) : null;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiParam({ name: 'id', type: String })
  async updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return await this.userService.updateUser(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user account' })
  async deleteUserAccount(@Param('id') id: string) {
    return await this.userService.deleteUserAccount(id);
  }

  @Get(':id/role')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user role (admin only)' })
  async getUserRole(@Param('id') id: string, @Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.getUserRole(id);
  }

  @Patch(':id/role')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user role (admin only)' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateUserRoleDto })
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: UserRole,
    @Req() req: any,
  ) {
    if (req.authUserData.userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admins only');
    }
    if (!Object.values(UserRole).includes(role)) {
      throw new ForbiddenException('Invalid role');
    }
    return await this.userService.updateUserRole(id, role);
  }
}