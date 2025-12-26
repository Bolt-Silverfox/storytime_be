import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isPremium = request.authUserData?.isPremium;

    response.status(429).json({
      statusCode: 429,
      message: isPremium
        ? 'Rate limit exceeded. Please try again in a few moments.'
        : 'Rate limit exceeded. Upgrade to premium for higher limits.',
      upgradeUrl: '/subscription/plans',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}