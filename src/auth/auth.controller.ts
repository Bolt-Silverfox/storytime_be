import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
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
  RequestResetDto,
  ValidateResetTokenDto,
  ResetPasswordDto,
  VerifyEmailDto,
  SendEmailVerificationDto,
} from './auth.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest, AuthSessionGuard } from './auth.guard';
import { Request } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'User login', description: 'Login for all roles.' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }
  //
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body('token') token: string) {
    return this.authService.refresh(token);
  }

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register new user',
    description: 'Default role: parent.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('logout')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from current session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully.' })
  async logout(@Req() req: AuthenticatedRequest) {
    const sessionId = req.authUserData['authSessionId'];
    if (!sessionId) {
      throw new UnauthorizedException('Invalid token');
    }
    return this.authService.logout(sessionId);
  }

  @Post('logout-all')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from all devices' })
  @ApiResponse({ status: 200, description: 'Logged out from all devices.' })
  async logoutAll(@Req() req: AuthenticatedRequest) {
    const userId = req.authUserData['userId'];
    return this.authService.logoutAllDevices(userId);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email using token' })
  @ApiResponse({ status: 200, description: 'Email verified successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid token.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBody({ type: VerifyEmailDto })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Post('send-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification token' })
  @ApiResponse({ status: 200, description: 'Verification email sent.' })
  @ApiBody({ type: SendEmailVerificationDto })
  async sendVerification(@Body() dto: SendEmailVerificationDto) {
    return this.authService.sendEmailVerification(dto.email);
  }

  @Put('profile')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  @ApiBody({ type: updateProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: updateProfileDto,
  ) {
    return this.authService.updateProfile(req.authUserData['userId'], data);
  }

  // ===== KIDS MANAGEMENT =====
  @Post('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add kids to user account' })
  @ApiBody({ type: [kidDto] })
  @ApiResponse({ status: 200, description: 'Kids added.' })
  async addKids(@Req() req: AuthenticatedRequest, @Body() data: kidDto[]) {
    return this.authService.addKids(req.authUserData['userId'], data);
  }

  @Get('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all kids for user' })
  @ApiResponse({ status: 200, description: 'List of kids.' })
  async getKids(@Req() req: AuthenticatedRequest) {
    return this.authService.getKids(req.authUserData['userId']);
  }

  @Put('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update kids information' })
  @ApiBody({ type: [updateKidDto] })
  @ApiResponse({ status: 200, description: 'Kids updated.' })
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
  @ApiBody({ type: [String], description: 'Array of kid IDs to delete.' })
  @ApiResponse({ status: 200, description: 'Kids deleted.' })
  async deleteKids(@Req() req: AuthenticatedRequest, @Body() data: string[]) {
    return this.authService.deleteKids(req.authUserData['userId'], data);
  }

  // ===== PASSWORD RESET =====
  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiBody({ type: RequestResetDto })
  @ApiResponse({ status: 200, description: 'Password reset email sent.' })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  async requestPasswordReset(@Body() body: RequestResetDto, @Req() req: Request) {
    // Extract IP and user agent for security checking
    const ip =
      req.ip ||
      req.headers['x-forwarded-for']?.toString().split(',')[0].trim();
    const userAgent = req.headers['user-agent'];
    return this.authService.requestPasswordReset(body, ip, userAgent);
  }

  @Post('validate-reset-token')
  @ApiOperation({ summary: 'Validate password reset token' })
  @ApiBody({ type: ValidateResetTokenDto })
  @ApiResponse({ status: 200, description: 'Token is valid.' })
  async validateResetToken(@Body() body: ValidateResetTokenDto) {
    return this.authService.validateResetToken(body.token, body.email, body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successful.' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(
      body.token,
      body.email,
      body.newPassword,
      body,
    );
  }
}
