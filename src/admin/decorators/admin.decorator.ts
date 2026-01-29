import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../../auth/auth.guard';
import { AdminGuard } from '../../auth/admin.guard';

/**
 * Admin decorator that combines authentication and admin authorization guards
 * Use this on routes that should only be accessible by admin users
 */
export function Admin() {
  return applyDecorators(UseGuards(AuthSessionGuard, AdminGuard));
}
