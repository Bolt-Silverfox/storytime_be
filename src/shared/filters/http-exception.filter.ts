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

    // Log the error for debugging purposes (excluding 400s/404s which are expected client errors)
    if (statusCode >= 500) {
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

    response.status(statusCode).json(errorBody);
  }
}
