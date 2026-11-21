import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthThrottleGuard } from '@/shared/guards/auth-throttle.guard';
import { THROTTLE_LIMITS } from '@/shared/config/throttle.config';
import {
  PasswordlessConsumeDto,
  PasswordlessRequestDto,
  PasswordlessRequestResponseDto,
  PasswordlessVerifyDto,
} from './dto/passwordless.dto';
import { PasswordlessEnabledGuard } from './guards/passwordless-enabled.guard';
import { PasswordlessBodyPipe } from './pipes/passwordless-body.pipe';
import { PasswordlessService } from './services/passwordless.service';

@ApiTags('Auth')
@Controller('auth/passwordless')
@SkipThrottle()
@UseGuards(PasswordlessEnabledGuard)
export class PasswordlessController {
  constructor(private readonly passwordlessService: PasswordlessService) {}

  @Post('request')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH_PASSWORDLESS_REQUEST.limit,
      ttl: THROTTLE_LIMITS.AUTH_PASSWORDLESS_REQUEST.ttl,
    },
  })
  @HttpCode(200)
  @ApiOperation({ summary: 'Email a one-time sign-in code and link' })
  @ApiBody({ type: PasswordlessRequestDto })
  @ApiResponse({ status: 200, type: PasswordlessRequestResponseDto })
  async request(@Body() body: PasswordlessRequestDto, @Req() req: Request) {
    return this.passwordlessService.request(body.email, req.ip);
  }

  @Post('verify')
  @UseGuards(AuthThrottleGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH_PASSWORDLESS_VERIFY.limit,
      ttl: THROTTLE_LIMITS.AUTH_PASSWORDLESS_VERIFY.ttl,
    },
  })
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with the emailed code' })
  @ApiBody({ type: PasswordlessVerifyDto })
  @ApiHeader({ name: 'x-guest-session-id', required: false })
  async verify(
    @Body(new PasswordlessBodyPipe(PasswordlessVerifyDto))
    body: PasswordlessVerifyDto & object,
    @Req() req: Request,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    return this.passwordlessService.verify(
      body.email,
      body.code,
      req.ip,
      guestSessionId,
    );
  }

  @Post('consume')
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.AUTH_PASSWORDLESS_CONSUME.limit,
      ttl: THROTTLE_LIMITS.AUTH_PASSWORDLESS_CONSUME.ttl,
    },
  })
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with the emailed link token' })
  @ApiBody({ type: PasswordlessConsumeDto })
  @ApiHeader({ name: 'x-guest-session-id', required: false })
  async consume(
    @Body(new PasswordlessBodyPipe(PasswordlessConsumeDto))
    body: PasswordlessConsumeDto & object,
    @Req() req: Request,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    return this.passwordlessService.consume(body.token, req.ip, guestSessionId);
  }
}
