import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_REGEX = /^[\w\-.]+$/;
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Normalize and validate an X-Request-ID header value.
 * Accepts a valid UUID or a safe string up to 128 chars.
 * Returns a new random UUID if the value is missing or invalid.
 */
function resolveRequestId(raw: string | string[] | undefined): string {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  if (!value) return randomUUID();

  if (UUID_REGEX.test(value)) return value;

  if (value.length <= MAX_REQUEST_ID_LENGTH && SAFE_ID_REGEX.test(value)) {
    return value;
  }

  return randomUUID();
}

// Extend Express Request to include requestId
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// Type for authenticated user from auth guard
interface AuthenticatedUser {
  id?: string;
  userId?: string;
  email?: string;
  userRole?: string;
}

interface RequestLogData {
  requestId: string;
  method: string;
  url: string;
  ip: string;
  userAgent: string;
  userId?: string;
  statusCode?: number;
  contentLength?: string;
  duration?: number;
}

/**
 * Request Logger Middleware
 * Logs incoming requests and outgoing responses with timing information
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();

    // Generate unique request ID for tracing
    const requestId = resolveRequestId(req.headers['x-request-id']);
    req.requestId = requestId;

    // Add request ID to response headers for client correlation
    res.setHeader('X-Request-ID', requestId);

    // Extract request info
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || 'unknown';

    // Skip logging for health check endpoints (too noisy)
    if (this.shouldSkipLogging(originalUrl)) {
      return next();
    }

    // Log incoming request
    this.logRequest({
      requestId,
      method,
      url: originalUrl,
      ip: ip || 'unknown',
      userAgent,
    });

    // Capture response finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { statusCode } = res;
      const contentLength = res.get('content-length') || '0';

      // Get user ID if authenticated (set by auth guard)
      const user = req.user as unknown as AuthenticatedUser | undefined;
      const userId = user?.userId || user?.id;

      this.logResponse({
        requestId,
        method,
        url: originalUrl,
        ip: ip || 'unknown',
        userAgent,
        userId,
        statusCode,
        contentLength,
        duration,
      });
    });

    next();
  }

  /**
   * Skip logging for noisy endpoints
   */
  private shouldSkipLogging(url: string): boolean {
    const skipPatterns = [
      '/health',
      '/api/v1/health',
      '/favicon.ico',
      '/robots.txt',
    ];

    return skipPatterns.some((pattern) => url.startsWith(pattern));
  }

  /**
   * Log incoming request
   */
  private logRequest(data: RequestLogData): void {
    this.logger.log(
      `→ ${data.method} ${data.url} [${data.requestId.slice(0, 8)}] from ${data.ip}`,
    );
  }

  /**
   * Log outgoing response
   */
  private logResponse(data: RequestLogData): void {
    const statusEmoji = this.getStatusEmoji(data.statusCode || 0);
    const userInfo = data.userId ? ` user:${data.userId.slice(0, 8)}` : '';

    const message =
      `${statusEmoji} ${data.method} ${data.url} ` +
      `${data.statusCode} ${data.duration}ms ` +
      `[${data.requestId.slice(0, 8)}]${userInfo}`;

    // Use appropriate log level based on status code
    if (data.statusCode && data.statusCode >= 500) {
      this.logger.error(message);
    } else if (data.statusCode && data.statusCode >= 400) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }

  /**
   * Get emoji based on HTTP status code
   */
  private getStatusEmoji(statusCode: number): string {
    if (statusCode >= 500) return '✗';
    if (statusCode >= 400) return '⚠';
    if (statusCode >= 300) return '↻';
    if (statusCode >= 200) return '←';
    return '?';
  }
}

/**
 * Functional middleware for use in main.ts
 * Alternative to class-based middleware
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const logger = new Logger('HTTP');
  const startTime = Date.now();

  const requestId = resolveRequestId(req.headers['x-request-id']);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const { method, originalUrl, ip } = req;

  // Skip health checks
  if (
    originalUrl.startsWith('/health') ||
    originalUrl.startsWith('/api/v1/health')
  ) {
    return next();
  }

  logger.log(
    `→ ${method} ${originalUrl} [${requestId.slice(0, 8)}] from ${ip}`,
  );

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { statusCode } = res;
    const user = req.user as unknown as AuthenticatedUser | undefined;
    const userId = user?.userId || user?.id;
    const userInfo = userId ? ` user:${userId.slice(0, 8)}` : '';

    const emoji = statusCode >= 500 ? '✗' : statusCode >= 400 ? '⚠' : '←';
    const message = `${emoji} ${method} ${originalUrl} ${statusCode} ${duration}ms [${requestId.slice(0, 8)}]${userInfo}`;

    if (statusCode >= 500) logger.error(message);
    else if (statusCode >= 400) logger.warn(message);
    else logger.log(message);
  });

  next();
}
