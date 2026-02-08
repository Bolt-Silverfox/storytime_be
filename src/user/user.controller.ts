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
import { UserDeletionService } from './services/user-deletion.service';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { UserDto, ProfileDto, AvatarDto } from '@/auth/dto/auth.dto';
import { UpdateUserDto } from './dto/user.dto';

import { UpdateParentProfileDto } from './dto/update-parent-profile.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { ParentProfileResponseDto } from './dto/parent-profile-response.dto';
import {
  mapParentProfile,
  UserWithRelations,
} from './utils/parent-profile.mapper';
import { DeleteAccountDto } from './dto/delete-account.dto';
import {
  ResetPinWithOtpDto,
  ValidatePinResetOtpDto,
} from './dto/pin-reset-otp.dto';

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
  constructor(
    private readonly userService: UserService,
    private readonly userDeletionService: UserDeletionService,
  ) {}
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
        message:
          'Your account has been deactivated. Please restore your account to continue.',
        data: {
          isDeleted: true,
          deletedAt: '2025-12-01T12:43:35.939Z',
          restoreEndpoint: '/api/v1/user/me/undo-delete',
        },
      },
    },
  })
  async getMe(@Req() req: AuthenticatedRequest) {
    const raw = (await this.userService.getUser(
      req.authUserData.userId,
    )) as UserWithRelations | null;

    // If user is not found (likely because isDeleted: true filter), check if user exists but is deleted
    if (!raw) {
      const userExists = await this.userService.getUserIncludingDeleted(
        req.authUserData.userId,
      );
      if (userExists && userExists.isDeleted) {
        throw new HttpException(
          {
            statusCode: 410,
            success: false,
            error: 'Gone',
            message:
              'Your account has been deactivated. Please restore your account to continue.',
            data: {
              isDeleted: true,
              deletedAt: userExists.deletedAt,
              restoreEndpoint: '/api/v1/user/me/undo-delete',
            },
          },
          HttpStatus.GONE,
        );
      }
    }

    return mapParentProfile(raw);
  }

  @Patch('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update parent profile' })
  async updateMyProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateParentProfileDto,
  ) {
    return this.userService.updateParentProfile(req.authUserData.userId, body);
  }

  @Post('me/avatar')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update parent avatar' })
  async updateAvatar(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateAvatarDto,
  ) {
    return this.userService.updateAvatarForParent(
      req.authUserData.userId,
      body,
    );
  }

  @Post('me/pin')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update PIN' })
  async setPin(@Req() req: AuthenticatedRequest, @Body() body: SetPinDto) {
    return this.userService.setPin(req.authUserData.userId, body.pin);
  }

  @Post('me/pin/verify')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify PIN to access profile' })
  @ApiBody({ type: SetPinDto })
  @ApiResponse({
    status: 200,
    description: 'PIN is correct',
    schema: {
      example: {
        success: true,
        message: 'PIN verified successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Incorrect PIN or no PIN set',
    schema: {
      example: {
        statusCode: 400,
        message: 'Incorrect PIN',
        error: 'Bad Request',
      },
    },
  })
  async verifyPin(@Req() req: AuthenticatedRequest, @Body() body: SetPinDto) {
    return this.userService.verifyPin(req.authUserData.userId, body.pin);
  }

  @Post('me/pin/request-reset')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request PIN reset via email OTP',
    description: 'Sends a 6-digit OTP to user email for PIN reset',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully',
    schema: {
      example: {
        success: true,
        message: 'PIN reset OTP sent to your email',
      },
    },
  })
  async requestPinResetOtp(@Req() req: AuthenticatedRequest) {
    return this.userService.requestPinResetOtp(req.authUserData.userId);
  }

  @Post('me/pin/validate-otp')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate PIN reset OTP' })
  @ApiResponse({
    status: 200,
    description: 'OTP is valid',
    schema: {
      example: {
        success: true,
        message: 'Valid OTP',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired OTP',
  })
  async validatePinResetOtp(
    @Req() req: AuthenticatedRequest,
    @Body() body: ValidatePinResetOtpDto,
  ) {
    return this.userService.validatePinResetOtp(
      req.authUserData.userId,
      body.otp,
    );
  }

  @Post('me/pin/reset-with-otp')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reset PIN using OTP',
    description: 'Reset PIN after validating OTP code',
  })
  @ApiResponse({
    status: 200,
    description: 'PIN reset successfully',
    schema: {
      example: {
        success: true,
        message: 'PIN has been reset successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid OTP or PIN mismatch',
  })
  async resetPinWithOtp(
    @Req() req: AuthenticatedRequest,
    @Body() body: ResetPinWithOtpDto,
  ) {
    if (body.newPin !== body.confirmNewPin) {
      throw new BadRequestException('New PIN and confirmation do not match');
    }
    return this.userService.resetPinWithOtp(
      req.authUserData.userId,
      body.otp,
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
    description:
      'Permanently delete the account and all associated data (default: false - soft delete)',
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
          message: 'Account deactivated successfully',
        },
        message: 'Account deactivated successfully',
      },
    },
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
          message:
            'Account and all associated data deleted permanently. All active sessions have been terminated.',
        },
        message: 'Account and all associated data deleted permanently',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    schema: {
      example: {
        statusCode: 404,
        success: false,
        error: 'Not Found',
        message: 'Account not found',
      },
    },
  })
  async deleteMe(
    @Req() req: AuthenticatedRequest,
    @Query('permanent') permanent: boolean = false,
  ) {
    const result = await this.userDeletionService.deleteUserAccount(
      req.authUserData.userId,
      permanent,
    );

    return {
      statusCode: 200,
      success: true,
      data: result,
      message: result.message,
    };
  }

  @Post('me/delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request account deletion (verify password + reasons)',
    description:
      'Verifies password and logs deletion request. After successful verification, use DELETE /api/v1/user/me to actually delete the account.',
  })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description:
      'Permanently delete the account and all associated data (default: false - soft delete)',
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
          message: 'Delete request submitted successfully.',
        },
        message: 'Delete request successful',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Account already deactivated',
    schema: {
      example: {
        statusCode: 400,
        success: false,
        error: 'Bad Request',
        message:
          'Account is already deactivated. Please restore your account first or contact support.',
      },
    },
  })
  async deleteAccountWithConfirmation(
    @Req() req: AuthenticatedRequest,
    @Body() body: DeleteAccountDto,
    @Query('permanent') permanent: boolean = false,
  ) {
    // Verify password and create support ticket
    await this.userDeletionService.verifyPasswordAndLogDeletion(
      req.authUserData.userId,
      body.password,
      body.reasons,
      body.notes,
      permanent,
    );

    return {
      statusCode: 200,
      success: true,
      data: {
        verified: true,
        message: 'Delete request submitted successfully.',
      },
      message: 'Delete request successful',
    };
  }

  @Post('me/undo-delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restore my soft deleted account',
    description:
      'Restore your own soft deleted account. Only works if your account was soft deleted.',
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
          updatedAt: '2023-10-02T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Account is not deleted or cannot be restored',
    schema: {
      example: {
        statusCode: 400,
        message: 'Your account is not deleted',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User not found',
        error: 'Not Found',
      },
    },
  })
  async undoDeleteMyAccount(@Req() req: AuthenticatedRequest) {
    const restoredUser = await this.userDeletionService.undoDeleteMyAccount(
      req.authUserData.userId,
    );

    return {
      statusCode: 200,
      message: 'Your account has been restored successfully',
      data: restoredUser,
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
    description:
      'Admins can see all users including both active and soft deleted users',
  })
  async getAllUsers(@Req() req: AuthenticatedRequest) {
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
    description: 'Get only active (non-deleted) users',
  })
  async getActiveUsers(@Req() req: AuthenticatedRequest) {
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
    if (!user) return null;
    return new UserDto(
      user as Partial<UserDto> & {
        profile?: Partial<ProfileDto> | null;
        avatar?: Partial<AvatarDto> | null;
        kids?: { id: string }[];
      },
    );
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
    description:
      'Permanently delete the account and all associated data (default: false - soft delete)',
  })
  async deleteUserAccount(
    @Param('id') id: string,
    @Query('permanent') permanent: boolean = false,
  ) {
    return await this.userDeletionService.deleteUserAccount(id, permanent);
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
          deletedAt: null,
        },
      },
    },
  })
  async undoDeleteUser(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }

    const restoredUser = await this.userDeletionService.undoDeleteUser(id);

    return {
      statusCode: 200,
      message: 'User restored successfully',
      data: restoredUser,
    };
  }

  @Get(':id/role')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user role (admin only)' })
  async getUserRole(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
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
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    if (!Object.values(UserRole).includes(role)) {
      throw new ForbiddenException('Invalid role');
    }
    return await this.userService.updateUserRole(id, role);
  }
}
