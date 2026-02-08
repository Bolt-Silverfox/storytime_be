import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface RequestBody {
  email?: string;
  [key: string]: unknown;
}

/**
 * Custom throttle guard for authentication endpoints
 * Tracks rate limits by email/username instead of IP address
 * This prevents brute force attacks on specific user accounts
 */
@Injectable()
export class AuthThrottleGuard extends ThrottlerGuard {
  /**
   * Generate a unique key for rate limiting based on email/username
   * Falls back to IP if no email is provided in the request body
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const request = context
      .switchToHttp()
      .getRequest<Request & { body?: RequestBody }>();

    // For login/signup, use email from request body
    // Ensure body exists and email is a string before normalizing
    const body = request.body;
    const email =
      body &&
      typeof body === 'object' &&
      'email' in body &&
      typeof body.email === 'string'
        ? body.email.toLowerCase().trim()
        : null;

    if (email) {
      // Track by email address (prevents brute force on specific accounts)
      return `${name}-${suffix}-email:${email}`;
    }

    // Fallback to IP-based tracking if no email provided
    return super.generateKey(context, suffix, name);
  }

  /**
   * Get the tracker string for error messages
   */
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as RequestBody | undefined;
    const email = body?.email;
    return Promise.resolve(email || (req.ip as string));
  }
}
