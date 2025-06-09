import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'User login', description: 'Authenticate a user and return a JWT token.' })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() body: any) {
    // Example only: Replace with DTO and real logic
    return this.authService.login(body);
  }

  @Post('register')
  @ApiOperation({ summary: 'User registration', description: 'Register a new user account.' })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid registration data.' })
  async register(@Body() body: any) {
    // Example only: Replace with DTO and real logic
    return this.authService.register(body);
  }
}
