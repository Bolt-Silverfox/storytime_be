import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { ErrorResponse } from '../dtos/api-response.dto';

// Catches all exceptions thrown by Prisma Client
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    let statusCode: HttpStatus;
    let message: string;
    let error: string;

    this.logger.error(`Prisma Error Code: ${exception.code}`, exception.stack);

    switch (exception.code) {
      // P2000: The value provided for the column is too long
      case 'P2000': {
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Input value is too long for a field.';
        error = 'Invalid Input';
        break;
      }
      // P2002: Unique constraint failed
      case 'P2002': {
        const fields =
          (exception.meta?.target as string[] | string) || 'unknown fields';
        statusCode = HttpStatus.CONFLICT;
        message = `A record with this identifier already exists: ${Array.isArray(fields) ? fields.join(', ') : String(fields)}.`;
        error = 'Conflict';
        break;
      }
      // P2025: An operation failed because it depends on one or more records that were required but not found
      case 'P2025': {
        message = (exception.meta?.cause as string) || 'Resource not found.';
        statusCode = HttpStatus.NOT_FOUND;
        error = 'Not Found';
        break;
      }
      // P2003: Foreign key constraint failed
      case 'P2003': {
        const field = (exception.meta?.field_name as string) || 'unknown';
        this.logger.error(
          `P2003 Foreign key constraint failed on field: ${field}`,
        );
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'The provided foreign key is invalid or does not exist.';
        error = 'Invalid Foreign Key';
        break;
      }
      default: {
        // P2004: A database error happened
        // P2005: The value stored in the database is invalid for the field
        // P2006: The provided value is not valid for the column type
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'A critical database error occurred.';
        error = 'Internal Server Error';
        break;
      }
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
