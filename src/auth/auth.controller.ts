import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Response, Request } from 'express';
import { GoogleOAuthProfile } from '@/shared/types';
import {
  Body,
  Controller,
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
import { OAuthService } from './services/oauth.service';
import { OnboardingService } from './services/onboarding.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';
import {
  LoginDto,
  LoginResponseDto,
  RefreshResponseDto,
  RefreshTokenDto,
  RegisterDto,
  UpdateProfileDto,
  RequestResetDto,
  ValidateResetTokenDto,
  ResetPasswordDto,
  VerifyEmailDto,
  SendEmailVerificationDto,
  ChangePasswordDto,
  CompleteProfileDto,
} from './dto/auth.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthThrottleGuard } from '@/shared/guards/auth-throttle.guard';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';
import { ConfigService } from '@nestjs/config';

@ApiTags('Auth')
@Controller('auth')
@SkipThrottle() // Skip default throttling, apply specific guards per endpoint
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oAuthService: OAuthService,
    private readonly onboardingService: OnboardingService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordService: PasswordService,
    private readonly configService: ConfigService,
  ) {}

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
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.REFRESH.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.REFRESH.TTL,
    },
  })
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.token);
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
    description:
      'Register with just full name, email, and password. Default role: parent.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.onboardingService.register(body);
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
    return this.onboardingService.completeProfile(
      req.authUserData['userId'],
      data,
    );
  }
  // ==================== GET LEARNING EXPECTATIONS ====================
  @Get('learning-expectations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get available learning expectations',
    description:
      'Fetch all active learning expectations that users can select during profile completion. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available learning expectations',
  })
  async getLearningExpectations() {
    return this.onboardingService.getLearningExpectations();
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
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.EMAIL_VERIFICATION.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.EMAIL_VERIFICATION.TTL,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email using token' })
  @ApiResponse({ status: 200, description: 'Email verified successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid token.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBody({ type: VerifyEmailDto })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.emailVerificationService.verifyEmail(verifyEmailDto.token);
  }

  @Post('send-verification')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.EMAIL_VERIFICATION.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.EMAIL_VERIFICATION.TTL,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification token' })
  @ApiResponse({ status: 200, description: 'Verification email sent.' })
  @ApiBody({ type: SendEmailVerificationDto })
  async sendVerification(@Body() dto: SendEmailVerificationDto) {
    return this.emailVerificationService.sendEmailVerification(dto.email);
  }

  @Put('profile')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: UpdateProfileDto,
  ) {
    return this.onboardingService.updateProfile(
      req.authUserData['userId'],
      data,
    );
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
    return this.passwordService.changePassword(
      req.authUserData['userId'],
      body,
      req.authUserData['authSessionId']!,
    );
  }

  // ===== PASSWORD RESET =====
  @Post('request-password-reset')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.PASSWORD_RESET_REQUEST.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.PASSWORD_RESET_REQUEST.TTL,
    },
  })
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
      req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0].trim();
    const userAgent = req.headers['user-agent'];
    return this.passwordService.requestPasswordReset(body, ip, userAgent);
  }

  @Post('validate-reset-token')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.PASSWORD_RESET.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.PASSWORD_RESET.TTL,
    },
  })
  @ApiOperation({ summary: 'Validate password reset token' })
  @ApiBody({ type: ValidateResetTokenDto })
  @ApiResponse({ status: 200, description: 'Token is valid.' })
  async validateResetToken(@Body() body: ValidateResetTokenDto) {
    return this.passwordService.validateResetToken(
      body.token,
      body.email,
      body,
    );
  }

  @Post('reset-password')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.PASSWORD_RESET.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.PASSWORD_RESET.TTL,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successful.' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.passwordService.resetPassword(
      body.token,
      body.email,
      body.newPassword,
      body,
    );
  }

  // ===== GOOGLE AUTH (MOBILE / WEB id_token) =====
  // Mobile or web app can POST an id_token payload { id_token: '...' }
  @Post('google')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.OAUTH.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.OAUTH.TTL,
    },
  })
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

    return this.oAuthService.loginWithGoogleIdToken(idToken);
  }

  // ===== APPLE AUTH (MOBILE / WEB id_token) =====
  @Post('apple')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH.OAUTH.LIMIT,
      ttl: THROTTLE_LIMITS.AUTH.OAUTH.TTL,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple sign-in (id_token) — mobile/web' })
  @ApiBody({
    description: 'Apple id_token and optional user info',
    schema: {
      example: { id_token: '...', firstName: 'John', lastName: 'Doe' },
    },
  })
  async appleIdToken(
    @Body() body: { id_token: string; firstName?: string; lastName?: string },
  ) {
    if (!body.id_token) {
      throw new BadRequestException('id_token is required');
    }

    return this.oAuthService.loginWithAppleIdToken(
      body.id_token,
      body.firstName,
      body.lastName,
    );
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
  async googleCallback(
    @Req() req: Request & { user: GoogleOAuthProfile },
    @Res() res: Response,
  ) {
    const payload = req.user;
    const result = await this.oAuthService.handleGoogleOAuthPayload(payload);

    return res.redirect(
      `${this.configService.get('WEB_APP_BASE_URL')}/oauth-success?jwt=${encodeURIComponent(
        result.jwt,
      )}&refresh=${encodeURIComponent(result.refreshToken)}`,
    );
  }
}
