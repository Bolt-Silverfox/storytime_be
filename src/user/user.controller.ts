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
  Post,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
  ApiQuery,
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
  constructor(private readonly userService: UserService) {}
  // ============================================================
  //                 SELF / PARENT PROFILE ENDPOINTS
  // ============================================================

  @Get('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: ParentProfileResponseDto })
  @ApiResponse({
    status: 410,
    description: 'Account is deactivated',
    schema: {
      example: {
        statusCode: 410,
        success: false,
        error: 'Gone',
        message: 'Your account has been deactivated. Please restore your account to continue.',
        data: {
          isDeleted: true,
          deletedAt: '2025-12-01T12:43:35.939Z',
          restoreEndpoint: '/api/v1/user/me/undo-delete'
        }
      }
    }
  })
  async getMe(@Req() req: any) {
    const raw = await this.userService.getUser(req.authUserData.userId);
    
    // If user is not found (likely because isDeleted: true filter), check if user exists but is deleted
    if (!raw) {
      const userExists = await this.userService.getUserIncludingDeleted(req.authUserData.userId);
      if (userExists && userExists.isDeleted) {
        throw new HttpException(
          {
            statusCode: 410,
            success: false,
            error: 'Gone',
            message: 'Your account has been deactivated. Please restore your account to continue.',
            data: {
              isDeleted: true,
              deletedAt: userExists.deletedAt,
              restoreEndpoint: '/api/v1/user/me/undo-delete'
            }
          },
          HttpStatus.GONE
        );
      }
    }
    
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
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete the account and all associated data (default: false - soft delete)'
  })
  @ApiResponse({
    status: 200,
    description: 'Account deactivated successfully (soft delete)',
    schema: {
      example: {
        statusCode: 200,
        success: true,
        data: {
          id: 'user-id',
          email: 'user@example.com',
          isDeleted: true,
          deletedAt: '2025-12-01T13:20:00.000Z',
          message: 'Account deactivated successfully'
        },
        message: 'Account deactivated successfully'
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Account and all associated data deleted permanently',
    schema: {
      example: {
        statusCode: 200,
        success: true,
        data: {
          id: 'user-id',
          email: 'user@example.com',
          message: 'Account and all associated data deleted permanently. All active sessions have been terminated.'
        },
        message: 'Account and all associated data deleted permanently'
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    schema: {
      example: {
        statusCode: 404,
        success: false,
        error: 'Not Found',
        message: 'Account not found'
      }
    }
  })
  async deleteMe(
    @Req() req: any,
    @Query('permanent') permanent: boolean = false
  ) {
    const result = await this.userService.deleteUserAccount(req.authUserData.userId, permanent);
    
    return {
      statusCode: 200,
      success: true,
      data: result,
      message: result.message
    };
  }

  @Post('me/delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Request account deletion (verify password + reasons)',
    description: 'Verifies password and logs deletion request. After successful verification, use DELETE /api/v1/user/me to actually delete the account.'
  })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete the account and all associated data (default: false - soft delete)'
  })
  @ApiResponse({
    status: 200,
    description: 'DELETE request submitted.',
    schema: {
      example: {
        statusCode: 200,
        success: true,
        data: {
          verified: true,
          message: 'Delete request submitted successfully.'
        },
        message: 'Delete request successful'
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Account already deactivated',
    schema: {
      example: {
        statusCode: 400,
        success: false,
        error: 'Bad Request',
        message: 'Account is already deactivated. Please restore your account first or contact support.'
      }
    }
  })
  async deleteAccountWithConfirmation(
    @Req() req: any,
    @Body() body: DeleteAccountDto,
    @Query('permanent') permanent: boolean = false
  ) {
    // Verify password and create support ticket
    const result = await this.userService.verifyPasswordAndLogDeletion(
      req.authUserData.userId,
      body.password,
      body.reasons,
      body.notes,
      permanent
    );

    return {
      statusCode: 200,
      success: true,
      data: {
        verified: true,
        message: 'Delete request submitted successfully.'
      },
      message: 'Delete request successful'
    };
  }

  @Post('me/undo-delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Restore my soft deleted account',
    description: 'Restore your own soft deleted account. Only works if your account was soft deleted.'
  })
  @ApiResponse({
    status: 200,
    description: 'Account restored successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Your account has been restored successfully',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'John Doe',
          isDeleted: false,
          deletedAt: null,
          createdAt: '2023-10-01T12:00:00Z',
          updatedAt: '2023-10-02T10:30:00Z'
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Account is not deleted or cannot be restored',
    schema: {
      example: {
        statusCode: 400,
        message: 'Your account is not deleted',
        error: 'Bad Request'
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User not found',
        error: 'Not Found'
      }
    }
  })
  async undoDeleteMyAccount(@Req() req: any) {
    const restoredUser = await this.userService.undoDeleteMyAccount(req.authUserData.userId);
    
    return {
      statusCode: 200,
      message: 'Your account has been restored successfully',
      data: restoredUser
    };
  }

  // ============================================================
  //                       ADMIN + GENERIC ROUTES
  // ============================================================

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'List all users (admin only)',
    description: 'Admins can see all users including both active and soft deleted users'
  })
  async getAllUsers(@Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.getAllUsers();
  }

  @Get('active')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'List only active users (admin only)',
    description: 'Get only active (non-deleted) users'
  })
  async getActiveUsers(@Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.getActiveUsers();
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
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete the account and all associated data (default: false - soft delete)'
  })
  async deleteUserAccount(
    @Param('id') id: string,
    @Query('permanent') permanent: boolean = false
  ) {
    return await this.userService.deleteUserAccount(id, permanent);
  }

  @Post(':id/undo-delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore soft deleted user account (admin only)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'User restored successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User restored successfully',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'John Doe',
          isDeleted: false,
          deletedAt: null
        }
      }
    }
  })
  async undoDeleteUser(
    @Param('id') id: string,
    @Req() req: any
  ) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }

    const restoredUser = await this.userService.undoDeleteUser(id);
    
    return {
      statusCode: 200,
      message: 'User restored successfully',
      data: restoredUser
    };
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