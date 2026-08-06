import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isPremium = request.authUserData?.isPremium;

    // Keep the shape consistent with the standard error envelope
    // (statusCode/success/error/message/path/timestamp) so clients get a
    // uniform, human-readable error instead of a raw framework string.
    response.status(429).json({
      statusCode: 429,
      success: false,
      error: 'Too Many Requests',
      message: isPremium
        ? 'You’ve made too many requests. Please wait a moment and try again.'
        : 'You’ve made too many requests. Please wait a moment and try again, or upgrade to premium for higher limits.',
      upgradeUrl: '/subscription/plans',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
