// src/auth/auth.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest, AuthSessionGuard } from './auth.guard';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  ///////////////////////////
  // Register
  ///////////////////////////
  @Post('register')
  @ApiOperation({
    summary: 'Register new user',
    description: 'Registers a new parent user.',
  })
  @ApiBody({
    schema: {
      example: {
        email: 'user@example.com',
        password: 'password',
        name: 'John Doe',
      },
    },
  })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  async register(
    @Body() body: { email: string; password: string; name: string },
  ) {
    return this.authService.registerUser(body);
  }

  ///////////////////////////
  // Login
  ///////////////////////////
  @Post('login')
  @ApiOperation({
    summary: 'Login user',
    description: 'Login for parent or admin.',
  })
  @ApiBody({
    schema: { example: { email: 'user@example.com', password: 'password' } },
  })
  @ApiResponse({ status: 200, description: 'User logged in successfully.' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.loginUser(body.email, body.password);
  }

  ///////////////////////////
  // Add Kid
  ///////////////////////////
  @Post('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add kid',
    description: 'Add a kid to the authenticated parent account.',
  })
  @ApiBody({
    schema: {
      example: { name: 'Kid Name', ageRange: '5-7', favoriteColor: 'blue' },
    },
  })
  async addKid(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      name: string;
      avatarId?: string;
      ageRange?: string;
      favoriteColor?: string;
      preferredVoiceId?: string;
    },
  ) {
    const parentId = req.authUserData['userId'];
    return this.authService.addKid(parentId, body);
  }

  ///////////////////////////
  // Get Kids
  ///////////////////////////
  @Get('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get kids',
    description: 'Get all kids for the authenticated parent.',
  })
  async getKids(@Req() req: AuthenticatedRequest) {
    const parentId = req.authUserData['userId'];
    return this.authService.getKids(parentId);
  }

  ///////////////////////////
  // Token Validation Example
  ///////////////////////////
  @Get('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user',
    description: 'Get info of authenticated user.',
  })
  async me(@Req() req: AuthenticatedRequest) {
    const userId = req.authUserData['userId'];
    return this.authService.getUserById(userId);
  }
}
