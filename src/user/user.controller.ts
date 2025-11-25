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
import {
  SetKidPreferredVoiceDto,
  KidVoiceDto,
  UpdateUserDto,
} from './dto/user.dto';
import { VOICEID, VoiceType } from '@/story/story.dto';
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

  
  // ==================== KID ENDPOINTS ====================
  @Get('kids/:kidId')
  @ApiOperation({
    summary: 'Get kid by ID',
    description: 'Retrieve a kid profile by kidId.',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Kid data returned.',
    schema: {
      example: {
        id: 'kid123',
        name: 'Tom',
        age: 6,
        avatar: { url: 'https://...' },
        preferredVoiceId: 'voice-abc',
        parent: {
          id: 'user123',
          name: 'Parent Name',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Kid not found' })
  async getKidById(@Param('kidId') kidId: string) {
    try {
      return await this.userService.getKidById(kidId);
    } catch (error) {
      this.logger.error(`Error fetching kid ${kidId}: ${error.message}`);
      throw error;
    }
  }

  @Patch('kids/:kidId/voice')
  @ApiOperation({ summary: 'Set preferred voice for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiBody({ type: SetKidPreferredVoiceDto })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async setKidPreferredVoice(
    @Param('kidId') kidId: string,
    @Body() body: SetKidPreferredVoiceDto,
  ) {
    this.logger.log(
      `Setting preferred voice for kid ${kidId} to ${JSON.stringify(body)}`,
    );
    if (!body.voiceType) {
      throw new BadRequestException('Voice type is required');
    }
    const voiceKey = body.voiceType.toUpperCase() as keyof typeof VOICEID;
    const voiceId = VOICEID[voiceKey];
    if (!voiceId) {
      throw new ForbiddenException('Invalid voice type');
    }
    return this.userService.setKidPreferredVoice(kidId, voiceKey as VoiceType);
  }

  @Get('kids/:kidId/voice')
  @ApiOperation({ summary: 'Get preferred voice for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async getKidPreferredVoice(@Param('kidId') kidId: string) {
    return await this.userService.getKidPreferredVoice(kidId);
<<<<<<< HEAD
  }

  // ==================== CURRENT USER ENDPOINTS ====================

  @Get('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user profile returned.',
    type: UserDto,
  })
  async getMe(@Req() req: any) {
    const user = await this.userService.getUser(
      req.authUserData.userId as string,
    );
    return user ? new UserDto(user) : null;
  }

  // ==================== USER CRUD ENDPOINTS ====================

  @Get(':id')
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Retrieve a user profile by ID.',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiResponse({
    status: 200,
    description: 'User profile returned.',
    schema: {
      example: {
        id: 'abc123',
        email: 'user@example.com',
        name: 'John Doe',
        avatarUrl: 'https://avatar.com',
        role: 'user',
        createdAt: '2023-10-01T12:00:00Z',
        updatedAt: '2023-10-01T12:00:00Z',
        profile: {
          explicitContent: true,
          maxScreenTimeMins: 60,
          language: 'en',
          country: 'nigeria',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUser(@Param('id') id: string) {
    const user = await this.userService.getUser(id);
    return user ? new UserDto(user) : null;
  }

  @Put(':id')
=======
  }

  // =========================================
  // SELF / PARENT PROFILE ENDPOINTS 
  // =========================================

  @Get('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
>>>>>>> 6bd2da9 (Feat:Implement parent profile)
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user profile returned.',
    type: ParentProfileResponseDto,
  })
  async getMe(@Req() req: any) {
    const raw = await this.userService.getUser(
      req.authUserData.userId as string,
    );
    return mapParentProfile(raw);
  }

<<<<<<< HEAD
  @Delete('account/:id')
  @ApiOperation({
    summary: 'Delete user account',
    description: 'Delete my account as a user',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiResponse({
    status: 200,
    description: 'User account deleted.',
    schema: { example: { id: 'abc123', deleted: true } },
  })
  async deleteUserAccount(@Param('id') id: string) {
    return this.userService.deleteUserAccount(id);
  }

  // ==================== ADMIN ENDPOINTS ====================
=======
  // ------------------------------------------------------
  //  PARENT PROFILE ENDPOINTS
  // ------------------------------------------------------

  @Patch('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update parent profile' })
  async updateMyProfile(
    @Req() req: any,
    @Body() body: UpdateParentProfileDto,
  ) {
    return this.userService.updateParentProfile(req.authUserData.userId, body);
  }

  @Post('me/avatar')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update parent avatar' })
  async updateAvatar(
    @Req() req: any,
    @Body() body: UpdateAvatarDto,
  ) {
    return this.userService.updateAvatarForParent(
      req.authUserData.userId,
      body,
    );
  }

  @Post('me/biometrics')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable biometrics' })
  async setBiometrics(
    @Req() req: any,
    @Body() body: EnableBiometricsDto,
  ) {
    return this.userService.setBiometrics(
      req.authUserData.userId,
      body.enable,
    );
  }

  @Post('me/pin')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update PIN' })
  async setPin(
    @Req() req: any,
    @Body() body: SetPinDto,
  ) {
    return this.userService.setPin(req.authUserData.userId, body.pin);
  }

  @Post('me/pin/verify')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify PIN' })
  async verifyPin(
    @Req() req: any,
    @Body() body: SetPinDto,
  ) {
    return this.userService.verifyPin(req.authUserData.userId, body.pin);
  }

  @Post('me/pin/reset')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset existing PIN (requires old PIN)' })
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

  // ------------------------------------------------------
   
  @Post('me/delete')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request account deletion (verify password + provide reasons)' })
  async deleteAccountWithConfirmation(@Req() req: any, @Body() body: DeleteAccountDto) {
    return this.userService.deleteAccountWithConfirmation(req.authUserData.userId, body.password, body.reasons, body.notes);
  }

>>>>>>> 6bd2da9 (Feat:Implement parent profile)

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all users (admin only)',
    description: 'Requires admin role and authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users returned.',
    schema: {
      example: [
        {
          id: 'abc123',
          email: 'user@example.com',
          name: 'John Doe',
          role: 'user',
        },
      ],
    },
  })
  async getAllUsers(@Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.getAllUsers();
  }
<<<<<<< HEAD
=======

  // ========================================================
  //  GENERIC USER ROUTES (id-based) 
  // ========================================================

  @Get(':id')
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Retrieve a user profile by ID.',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiResponse({
    status: 200,
    description: 'User profile returned.',
    schema: {
      example: {
        id: 'abc123',
        email: 'user@example.com',
        name: 'Joseph',
        avatarUrl: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1764085773/Joseph_avatar_jxeeja.png',
        role: 'user',
        createdAt: '2023-10-01T12:00:00Z',
        updatedAt: '2023-10-01T12:00:00Z',
        profile: {
          explicitContent: true,
          maxScreenTimeMins: 60,
          language: 'en',
          country: 'nigeria',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUser(@Param('id') id: string) {
    const user = await this.userService.getUser(id);
    return user ? new UserDto(user) : null;
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update user profile',
    description: 'Update a user profile by ID.',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiBody({
    type: UpdateUserDto,
    examples: {
      example1: {
        value: {
          title: 'Ms',
          name: 'Judas',
          avatarUrl: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1764085758/Judas_avatar_t5l8oh.png',
          language: 'en',
          country: 'nigeria',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated.',
    schema: {
      example: {
        id: 'abc123',
        title: 'Ms',
        name: 'Jamina',
        avatarUrl: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1764085740/Jamina_avatar_go3yd9.png',
        language: 'en',
        country: 'nigeria',
        numberOfKids: 1,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return await this.userService.updateUser(id, body);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'delete user account',
    description: 'delete my account as a user',
  })
  async deleteUserAccount(@Param('id') id: string) {
    return this.userService.deleteUserAccount(id);
  }

  // ------------------------------------------------------
>>>>>>> 6bd2da9 (Feat:Implement parent profile)

  @Delete(':id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete user (admin only)',
    description: 'Requires admin role and authentication.',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiResponse({
    status: 200,
    description: 'User deleted.',
    schema: { example: { id: 'abc123', deleted: true } },
  })
  async deleteUser(@Param('id') id: string, @Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.deleteUser(id);
  }

  @Get(':id/role')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user role (admin only)',
    description: 'Requires admin role and authentication.',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiResponse({
    status: 200,
    description: 'User role returned.',
    schema: { example: { id: 'abc123', role: 'admin' } },
  })
  async getUserRole(@Param('id') id: string, @Req() req: any) {
    if (req.authUserData.userRole !== 'admin') {
      throw new ForbiddenException('Admins only');
    }
    return await this.userService.getUserRole(id);
  }

  @Patch(':id/role')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user role (admin only)',
    description: 'Requires admin role and authentication.',
  })
  @ApiParam({ name: 'id', type: String, description: 'The user ID' })
  @ApiBody({
    type: UpdateUserRoleDto,
    examples: { example1: { value: { role: 'admin' } } },
  })
  @ApiResponse({
    status: 200,
    description: 'User role updated.',
    schema: { example: { id: 'abc123', role: 'admin' } },
  })
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
<<<<<<< HEAD
}
=======
}
>>>>>>> 6bd2da9 (Feat:Implement parent profile)
