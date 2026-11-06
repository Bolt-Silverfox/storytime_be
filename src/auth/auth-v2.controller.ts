import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottleGuard } from '@/shared/guards/auth-throttle.guard';
import { THROTTLE_LIMITS } from '@/shared/config/throttle.config';
import { API_V2_ROUTE_BASE } from '@/shared/config/api-prefix';
import {
  RegisterDto,
  RegisterV2ResponseDto,
  VerifyEmailV2Dto,
  VerifyEmailV2ResponseDto,
} from './dto/auth.dto';
import { RegisterV2EnabledGuard } from './guards/register-v2-enabled.guard';
import { OnboardingService } from './services/onboarding.service';
import { VerifyFirstService } from './services/verify-first.service';

@ApiTags('Auth v2')
@Controller(`${API_V2_ROUTE_BASE}/auth`)
@UseGuards(RegisterV2EnabledGuard)
export class AuthV2Controller {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly verifyFirstService: VerifyFirstService,
  ) {}

  @Post('register')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH_REGISTER.limit,
      ttl: THROTTLE_LIMITS.AUTH_REGISTER.ttl,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register new user without opening a session',
    description:
      'Creates the account and emails a verification code. No jwt or refresh token is returned; call POST /api/v2/auth/verify-email with the code to sign in.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 200, type: RegisterV2ResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.onboardingService.registerV2(body);
  }

  @Post('verify-email')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH_OTP.limit,
      ttl: THROTTLE_LIMITS.AUTH_OTP.ttl,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email with the emailed code and sign in',
    description:
      'The code is bound to the email, allows 5 attempts, and is single use. Every failure returns the same 400 "Invalid or expired code".',
  })
  @ApiBody({ type: VerifyEmailV2Dto })
  @ApiResponse({ status: 200, type: VerifyEmailV2ResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or expired code' })
  async verifyEmail(@Body() body: VerifyEmailV2Dto) {
    return this.verifyFirstService.verifyEmail(body.email, body.token);
  }
}
