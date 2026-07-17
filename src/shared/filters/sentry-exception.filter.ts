import { Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { captureException } from '../../sentry-setup';

/**
 * Catch-all filter that reports otherwise-unhandled exceptions to Sentry.
 *
 * It is registered with the LOWEST priority (first in the global filter list,
 * which Nest searches last), so it only runs for exceptions no other filter
 * — HttpExceptionFilter, PrismaExceptionFilter, etc. — already handled.
 *
 * It is only registered when Sentry is enabled (SENTRY_DSN set), so with no DSN
 * the filter chain is byte-identical to before. When it does run, it preserves
 * the exact default response by delegating to BaseExceptionFilter.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (SentryExceptionFilter.shouldReport(exception)) {
      captureException(exception);
    }
    // Preserve default response behavior for unhandled exceptions.
    super.catch(exception, host);
  }

  private static shouldReport(exception: unknown): boolean {
    // Never report expected client errors (4xx). Report server errors (>= 500)
    // and any non-HttpException (genuinely unexpected) failures.
    if (exception instanceof HttpException) {
      return exception.getStatus() >= 500;
    }
    return true;
  }
}
