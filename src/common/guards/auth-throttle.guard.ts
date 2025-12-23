import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

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
        const request = context.switchToHttp().getRequest<Request & { body?: { email?: string } }>();

        // For login/signup, use email from request body
        const email = request.body?.email?.toLowerCase();

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
    protected async getTracker(req: Record<string, any>): Promise<string> {
        const email = req.body?.email;
        return email || req.ip;
    }
}
