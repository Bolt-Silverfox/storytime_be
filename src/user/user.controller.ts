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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { AuthSessionGuard } from '../auth/auth.guard';
import { UserDto } from '../auth/auth.dto';
import {
  SetKidPreferredVoiceDto,
  KidVoiceDto,
  UpdateUserDto,
} from './user.dto';
import { SetKidPreferredVoiceDto, KidVoiceDto } from './user.dto';
import { VOICEID, VoiceType } from '@/story/story.dto';

export enum UserRole {
  ADMIN = 'admin',
  PARENT = 'parent',
  KID = 'kid',
}

class UpdateUserDto {
  @ApiProperty({ example: 'John Doe' })
  name?: string;

  @ApiProperty({ example: 'https://avatar.com' })
  avatarUrl?: string;

  @ApiProperty({ example: 'en' })
  language?: string;

  @ApiProperty({ example: 'Nigeria' })
  country?: string;

  @ApiProperty({ example: 'Mr' })
  title?: string;

  @ApiProperty({ example: 1 })
  numberOfKids?: number;
}

class UpdateUserRoleDto {
  role: UserRole;
}

@ApiTags('user')
@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);
  constructor(private readonly userService: UserService) {}

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
          title: 'Mr',
          name: 'Jane Doe',
          avatarUrl: 'https://avatar.com/jane',
          name: 'Jane Doe',
          avatarUrl: 'https://avatar.com/jane',
          language: 'en',
          country: 'nigeria',
          title: 'Mr',
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
        title: 'Mr',
        name: 'Jane Doe',
        avatarUrl: 'https://avatar.com/jane',
        language: 'en',
        country: 'nigeria',
        title: 'Mr',
        numberOfKids: 1,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return await this.userService.updateUser(id, body);
  }

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

  @Get('kids/:kidId/voice')
  @ApiOperation({ summary: 'Get preferred voice for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async getKidPreferredVoice(@Param('kidId') kidId: string) {
    return await this.userService.getKidPreferredVoice(kidId);
  }
}
