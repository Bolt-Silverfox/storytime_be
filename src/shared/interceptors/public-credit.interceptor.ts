import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { maskSourceFieldsForPublic } from '../utils/public-credit.util';

/** `/admin` as a whole path segment (after the optional /api/v1 prefix). */
const ADMIN_PATH = /^(?:\/api\/v\d+)?\/admin(?:[/?#]|$)/;

/**
 * Global response filter: public-domain stories never expose sourceName or
 * sourceUrl to API clients, on any endpoint that returns story rows (feeds,
 * library, favourites, downloads, guest, GET /stories/:id ...). Admin routes
 * are exempt. Applied centrally so a new endpoint cannot forget it.
 */
@Injectable()
export class PublicCreditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<{ originalUrl?: string; url?: string }>();
    const url = req.originalUrl ?? req.url ?? '';
    if (ADMIN_PATH.test(url)) return next.handle();
    return next.handle().pipe(map((data) => maskSourceFieldsForPublic(data)));
  }
}
