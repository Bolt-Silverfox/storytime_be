import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponse } from '../dtos/api-response.dto';
import { DomainException } from '../exceptions/domain.exception';
import { captureException } from '../../sentry-setup';

/** Shape of NestJS exception response objects */
interface ExceptionResponseObject {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // Determine the error message(s), code, and details
    let message: string | string[];
    let error: string;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;

    // Check if this is a DomainException for enhanced error handling
    if (exception instanceof DomainException) {
      code = exception.code;
      details = exception.details;
    }

    if (typeof exceptionResponse === 'string') {
      // Standard HttpException response is a string
      message = exceptionResponse;
      error = HttpStatus[statusCode]
        .toString()
        .split('_')
        .map((s) => s.charAt(0) + s.slice(1).toLowerCase())
        .join(' '); // e.g. "Bad Request"
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      // NestJS validation pipe error structure or DomainException response
      const resObj = exceptionResponse as ExceptionResponseObject;
      message = resObj.message || 'An error occurred.';
      error = resObj.error || HttpStatus[statusCode];
      // Extract code and details from response if not already set
      if (!code && resObj.code) code = resObj.code;
      if (!details && resObj.details) details = resObj.details;
    } else {
      message = 'An unknown HTTP error occurred.';
      error = HttpStatus[statusCode];
    }

    // Never leak a raw framework exception class name to the client, e.g.
    // "ThrottlerException: Too Many Requests" — strip the "SomeException:"
    // prefix so users see a plain message.
    const stripExceptionPrefix = (m: string): string =>
      m.replace(/^[A-Z][A-Za-z0-9]*Exception:\s*/, '');
    if (typeof message === 'string') {
      message = stripExceptionPrefix(message);
    } else if (Array.isArray(message)) {
      message = message.map((m) =>
        typeof m === 'string' ? stripExceptionPrefix(m) : m,
      );
    }

    // Friendly, actionable copy for rate limiting (the dedicated
    // ThrottlerExceptionFilter provides a premium-aware variant when it wins).
    // NOTE: this replaces the message on EVERY 429 that reaches this filter,
    // not only raw framework strings -- a deliberate domain message such as
    // QuotaExceededException's would be overwritten too (it has no call sites
    // today; revisit this branch before giving it one).
    //
    // `getStatus()` is typed `number` while the enum member is a literal, so
    // the member is widened to satisfy no-unsafe-enum-comparison. The
    // alternative -- annotating `statusCode` as `HttpStatus` and dropping this
    // cast -- just moves the same error onto the `statusCode >= 500`
    // comparison below, which compares against a plain number. (Doing both at
    // once is worse: an `HttpStatus`-typed left side against a `number`-widened
    // right side re-flags this line too.)
    if (statusCode === (HttpStatus.TOO_MANY_REQUESTS as number)) {
      message = 'Too many requests. Please wait a moment and try again.';
    }

    // Log the error for debugging purposes (excluding 400s/404s which are expected client errors)
    if (statusCode >= 500) {
      // Report server-side failures to Sentry (no-op when Sentry is disabled).
      captureException(exception);
      this.logger.error(
        `[${request.method}] ${request.url} - Status: ${statusCode}${code ? ` - Code: ${code}` : ''}`,
        exception.stack,
      );
    } else {
      this.logger.warn(
        `[${request.method}] ${request.url} - Status: ${statusCode}${code ? ` - Code: ${code}` : ''} - Message: ${Array.isArray(message) ? message.join(', ') : message}`,
      );
    }

    // Create the standardized error response with optional code and details
    const errorBody = new ErrorResponse(
      statusCode,
      error,
      message,
      request.url,
      code,
      details,
    );

    // Preserve extra fields from structured exception responses (e.g. existingProviders in 409s)
    const extras =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? Object.fromEntries(
            Object.entries(exceptionResponse as Record<string, unknown>).filter(
              ([k]) =>
                ![
                  'statusCode',
                  'error',
                  'message',
                  'path',
                  'timestamp',
                  'success',
                ].includes(k),
            ),
          )
        : {};

    response.status(statusCode).json({ ...errorBody, ...extras });
  }
}
