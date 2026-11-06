import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class RegisterV1DeprecationInterceptor implements NestInterceptor {
  constructor(private readonly configService: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const sunset = this.configService.get<string>('REGISTER_V1_SUNSET');
    const sunsetDate = sunset ? new Date(sunset) : null;
    if (sunsetDate && !Number.isNaN(sunsetDate.getTime())) {
      const res = context.switchToHttp().getResponse<Response>();
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', sunsetDate.toUTCString());
    }
    return next.handle();
  }
}
