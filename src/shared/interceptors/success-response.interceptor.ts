import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SuccessResponse } from '../dtos/api-response.dto';

// Transforms the response data from all successful Controller methods
@Injectable()
export class SuccessResponseInterceptor<T>
  implements NestInterceptor<T, SuccessResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<SuccessResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        const statusCode = (response.statusCode as number) || HttpStatus.OK;

        // Handle cases where NestJS returns only a status code (e.g., 204 No Content).
        // If data is explicitly null/undefined, we might just return the status code without a body.
        // However, for consistency, we wrap it with an empty object if no data is present.
        const responseData = data === undefined ? {} : data;

        // Note: The message can be customized per endpoint if needed, but defaults to this.
        return new SuccessResponse(
          statusCode,
          responseData,
          'Request completed successfully.',
        );
      }),
    );
  }
}
