import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UserAuthService } from './UserAuth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshResponseDto } from './dto/RefreshResponse.dto';
import { LoginResponseDto } from './dto/loginResponse.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthSessionGuard } from '@/auth/guards/auth.guard';
import { AuthenticatedRequest } from '@/auth/guards/auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class UserAuthController {
  constructor(private readonly authService: UserAuthService) {}

  // LOGIN
  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  // REFRESH TOKEN
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Query('token') token: string) {
    return this.authService.refresh(token);
  }

  // REGISTER
  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  // LOGOUT ONE SESSION
  @Post('logout')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  async logout(@Req() req: AuthenticatedRequest) {
    const sessionId = req.authUserData['authSessionId'];
    if (!sessionId) throw new UnauthorizedException('invalid token');
    return this.authService.logout(sessionId);
  }

  // LOGOUT ALL DEVICES
  @Post('logout-all')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  async logoutAll(@Req() req: AuthenticatedRequest) {
    return this.authService.logoutAllDevices(req.authUserData['userId']);
  }

  // VERIFY EMAIL
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email with token' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  // RESEND VERIFY EMAIL
  @Post('send-verification')
  @ApiOperation({ summary: 'Resend email verification token' })
  async sendVerification(@Query('email') email: string) {
    return this.authService.sendEmailVerification(email);
  }

  // REQUEST PASSWORD RESET
  @Post('request-password-reset')
  @ApiOperation({ summary: 'Request password reset' })
  async requestPasswordReset(@Query('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  // VALIDATE RESET TOKEN
  @Get('validate-reset-token')
  @ApiOperation({ summary: 'Validate password reset token' })
  async validateResetToken(
    @Query('token') token: string,
    @Query('email') email: string,
  ) {
    return this.authService.validateResetToken(token, email);
  }

  // RESET PASSWORD
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password' })
  async resetPassword(
    @Query('token') token: string,
    @Query('newPassword') password: string,
  ) {
    return this.authService.resetPassword(token, password);
  }
}
