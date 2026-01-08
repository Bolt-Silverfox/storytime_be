import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Response, Request } from 'express';
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
  BadRequestException,
  Res,
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
  ChangePasswordDto,
  CompleteProfileDto,
} from './auth.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest, AuthSessionGuard } from './auth.guard';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthThrottleGuard } from '../common/guards/auth-throttle.guard';
import { THROTTLE_LIMITS } from '@/common/constants/throttle.constants';

@ApiTags('Auth')
@Controller('auth')
@SkipThrottle() // Skip default throttling, apply specific guards per endpoint
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.LOGIN.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.LOGIN.TTL,
    },
  })
  @HttpCode(200)
  @ApiOperation({ summary: 'User login', description: 'Login for all roles.' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body('token') token: string) {
    return this.authService.refresh(token);
  }

  @Post('register')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.REGISTER.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.REGISTER.TTL,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register new user',
    description: 'Default role: parent. Language and preferred themes set in complete-profile step.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  // ==================== COMPLETE PROFILE (NEW) ====================
  @Post('complete-profile')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete user profile after registration',
    description:
      'Set language, preferred learning expectations (IDs), preferred categories (IDs), and profile image. Must be called after email verification.',
  })
  @ApiBody({ type: CompleteProfileDto })
  @ApiResponse({
    status: 200,
    description: 'Profile completed successfully',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid themes or missing required fields',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT required',
  })
  async completeProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: CompleteProfileDto,
  ) {
    return this.authService.completeProfile(req.authUserData['userId'], data);
  }
  // ==================== GET LEARNING EXPECTATIONS ====================
  @Get('learning-expectations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get available learning expectations',
    description: 'Fetch all active learning expectations that users can select during profile completion. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available learning expectations',
  })
  async getLearningExpectations() {
    return this.authService.getLearningExpectations();
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

  @Post('change-password')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password changed successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid old password.' })
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.authUserData['userId'],
      body,
      req.authUserData['authSessionId']!,
    );
  }

  // ===== PASSWORD RESET =====
  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiBody({ type: RequestResetDto })
  @ApiResponse({ status: 200, description: 'Password reset email sent.' })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  async requestPasswordReset(
    @Body() body: RequestResetDto,
    @Req() req: Request,
  ) {
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

  // ===== GOOGLE AUTH (MOBILE / WEB id_token) =====
  // Mobile or web app can POST an id_token payload { id_token: '...' }
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google sign-in (id_token) — mobile/web' })
  @ApiBody({
    description: 'Google id_token',
    schema: { example: { id_token: 'eyJhbGci...' } },
  })
  async googleIdToken(@Body('id_token') idToken: string) {
    if (!idToken) {
      throw new BadRequestException('id_token is required');
    }

    return this.authService.loginWithGoogleIdToken(idToken);
  }

  // ===== GOOGLE OAUTH (web redirect flow) =====
  @Get('google/oauth')
  @UseGuards(GoogleAuthGuard)
  async googleLogin() {
    // Guard will redirect to Google
  }

  // ===== GOOGLE OAUTH CALLBACK =====
  @Get('google/oauth/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const payload = (req as any).user;
    const result = await this.authService.handleGoogleOAuthPayload(payload);

    return res.redirect(
      `${process.env.WEB_APP_BASE_URL}/oauth-success?jwt=${encodeURIComponent(
        result.jwt,
      )}&refresh=${encodeURIComponent(result.refreshToken)}`,
    );
  }
}