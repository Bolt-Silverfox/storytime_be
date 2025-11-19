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

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(HttpExceptionFilter.name);

    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();
        const statusCode = exception.getStatus();
        const exceptionResponse = exception.getResponse();

        // Determine the error message(s)
        let message: string | string[];
        let error: string;

        if (typeof exceptionResponse === 'string') {
            // Standard HttpException response is a string
            message = exceptionResponse;
            error = HttpStatus[statusCode].toString().split('_').map(s => s.charAt(0) + s.slice(1).toLowerCase()).join(' '); // e.g. "Bad Request"
        } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
            // NestJS validation pipe error structure
            const resObj = exceptionResponse as any;
            message = resObj.message || 'An error occurred.';
            error = resObj.error || HttpStatus[statusCode];
        } else {
            message = 'An unknown HTTP error occurred.';
            error = HttpStatus[statusCode];
        }

        // Log the error for debugging purposes (excluding 400s/404s which are expected client errors)
        if (statusCode >= 500) {
            this.logger.error(
                `[${request.method}] ${request.url} - Status: ${statusCode}`,
                exception.stack,
            );
        } else {
            this.logger.warn(
                `[${request.method}] ${request.url} - Status: ${statusCode} - Message: ${Array.isArray(message) ? message.join(', ') : message}`,
            );
        }

        // Create the standardized error response
        const errorBody = new ErrorResponse(
            statusCode,
            error,
            message,
            request.url,
        );

        response.status(statusCode).json(errorBody);
    }
}