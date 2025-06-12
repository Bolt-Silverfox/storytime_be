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
import { AuthService } from './auth.service';
import {
  kidDto,
  LoginDto,
  LoginResponseDto,
  RefreshResponseDto,
  RegisterDto,
  updateKidDto,
  updateProfileDto,
} from './auth.dto';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest, AuthSessionGuard } from './auth.gaurd';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Query('token') token: string) {
    return this.authService.refresh(token);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('logout')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from current session' })
  async logout(@Req() req: AuthenticatedRequest) {
    const sessionId = req.authUserData['authSessionId'];
    if (!sessionId) {
      throw new UnauthorizedException('invalid token');
    }
    return this.authService.logout(sessionId);
  }

  @Post('logout-all')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from all devices' })
  async logoutAll(@Req() req: AuthenticatedRequest) {
    const userId = req.authUserData['userId'];
    return this.authService.logoutAllDevices(userId);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email with token' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('send-verification')
  @ApiOperation({ summary: 'Resend email verification token' })
  async sendVerification(@Query('email') email: string) {
    return this.authService.sendEmailVerification(email);
  }

  @Put('profile')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: updateProfileDto,
  ) {
    return this.authService.updateProfile(req.authUserData['userId'], data);
  }

  @Post('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add kids to user account' })
  async addKids(@Req() req: AuthenticatedRequest, @Body() data: kidDto[]) {
    return this.authService.addKids(req.authUserData['userId'], data);
  }

  @Get('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all kids for user' })
  async getKids(@Req() req: AuthenticatedRequest) {
    return this.authService.getKids(req.authUserData['userId']);
  }

  @Put('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update kids information' })
  async updateKids(
    @Req() req: AuthenticatedRequest,
    @Body() data: updateKidDto[],
  ) {
    return this.authService.updateKids(req.authUserData['userId'], data);
  }

  @Delete('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete kids from user account' })
  async deleteKids(@Req() req: AuthenticatedRequest, @Body() data: string[]) {
    return this.authService.deleteKids(req.authUserData['userId'], data);
  }

  @Post('request-password-reset')
  @ApiOperation({ summary: 'Request password reset' })
  async requestPasswordReset(@Query('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  @Get('validate-reset-token')
  @ApiOperation({ summary: 'Validate password reset token' })
  async validateResetToken(
    @Query('token') token: string,
    @Query('email') email: string,
  ) {
    return this.authService.validateResetToken(token, email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(
    @Query('token') token: string,
    @Query('newPassword') password: string,
  ) {
    return this.authService.resetPassword(token, password);
  }
}
