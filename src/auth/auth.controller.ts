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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest, AuthSessionGuard } from './auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Login for all roles (admin, parent, kid).',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Refresh JWT using a valid refresh token.',
  })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Query('token') token: string) {
    return this.authService.refresh(token);
  }

  @Post('register')
  @ApiOperation({
    summary: 'Register new user',
    description:
      'Register as a parent (default). Only admins can create admin accounts.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('logout')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout from current session',
    description: 'Requires authentication.',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully.' })
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
  @ApiOperation({
    summary: 'Logout from all devices',
    description: 'Requires authentication.',
  })
  @ApiResponse({ status: 200, description: 'Logged out from all devices.' })
  async logoutAll(@Req() req: AuthenticatedRequest) {
    const userId = req.authUserData['userId'];
    return this.authService.logoutAllDevices(userId);
  }

  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify email with token',
    description: 'Verify user email using a verification token.',
  })
  @ApiResponse({ status: 200, description: 'Email verified.' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('send-verification')
  @ApiOperation({
    summary: 'Resend email verification token',
    description: 'Send a new email verification token.',
  })
  @ApiResponse({ status: 200, description: 'Verification email sent.' })
  async sendVerification(@Query('email') email: string) {
    return this.authService.sendEmailVerification(email);
  }

  @Put('profile')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user profile',
    description:
      'Requires authentication. Only the authenticated user can update their profile.',
  })
  @ApiBody({ type: updateProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: updateProfileDto,
  ) {
    return this.authService.updateProfile(req.authUserData['userId'], data);
  }

  @Post('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add kids to user account',
    description: 'Requires parent role.',
  })
  @ApiBody({ type: [kidDto] })
  @ApiResponse({ status: 200, description: 'Kids added.' })
  async addKids(@Req() req: AuthenticatedRequest, @Body() data: kidDto[]) {
    return this.authService.addKids(req.authUserData['userId'], data);
  }

  @Get('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all kids for user',
    description: 'Requires parent role.',
  })
  @ApiResponse({ status: 200, description: 'List of kids.' })
  async getKids(@Req() req: AuthenticatedRequest) {
    return this.authService.getKids(req.authUserData['userId']);
  }

  @Put('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update kids information',
    description: 'Requires parent role.',
  })
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
  @ApiOperation({
    summary: 'Delete kids from user account',
    description: 'Requires parent role.',
  })
  @ApiBody({ type: [String], description: 'Array of kid IDs to delete.' })
  @ApiResponse({ status: 200, description: 'Kids deleted.' })
  async deleteKids(@Req() req: AuthenticatedRequest, @Body() data: string[]) {
    return this.authService.deleteKids(req.authUserData['userId'], data);
  }

  @Post('request-password-reset')
  @ApiOperation({
    summary: 'Request password reset',
    description: 'Send a password reset email.',
  })
  @ApiResponse({ status: 200, description: 'Password reset email sent.' })
  async requestPasswordReset(@Query('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  @Get('validate-reset-token')
  @ApiOperation({
    summary: 'Validate password reset token',
    description: 'Validate a password reset token.',
  })
  @ApiResponse({ status: 200, description: 'Token is valid.' })
  async validateResetToken(
    @Query('token') token: string,
    @Query('email') email: string,
  ) {
    return this.authService.validateResetToken(token, email);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password with token',
    description: 'Reset password using a valid token.',
  })
  @ApiResponse({ status: 200, description: 'Password reset successful.' })
  async resetPassword(
    @Query('token') token: string,
    @Query('newPassword') password: string,
  ) {
    return this.authService.resetPassword(token, password);
  }
}
