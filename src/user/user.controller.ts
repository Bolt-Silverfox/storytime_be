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
import { SetKidPreferredVoiceDto, KidVoiceDto } from './user.dto';

export enum UserRole {
  ADMIN = 'admin',
  PARENT = 'parent',
  KID = 'kid',
}

class UpdateUserDto {
  name?: string;
  avatarUrl?: string;
}

class UpdateUserRoleDto {
  role: UserRole;
}

@ApiTags('user')
@Controller('user')
export class UserController {
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
        value: { name: 'Jane Doe', avatarUrl: 'https://avatar.com/jane' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated.',
    schema: {
      example: {
        id: 'abc123',
        name: 'Jane Doe',
        avatarUrl: 'https://avatar.com/jane',
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

  @Patch('kids/:kidId/voice')
  @ApiOperation({ summary: 'Set preferred voice for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiBody({ type: SetKidPreferredVoiceDto })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async setKidPreferredVoice(
    @Param('kidId') kidId: string,
    @Body() body: SetKidPreferredVoiceDto,
  ) {
    return this.userService.setKidPreferredVoice({
      kidId,
      voiceId: body.voiceId,
    });
  }

  @Get('kids/:kidId/voice')
  @ApiOperation({ summary: 'Get preferred voice for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: KidVoiceDto })
  async getKidPreferredVoice(@Param('kidId') kidId: string) {
    return this.userService.getKidPreferredVoice(kidId);
  }
}
