import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Request headers browsers may send cross-origin. Any custom header the web or
 * mobile client attaches MUST be listed here, otherwise the CORS preflight
 * succeeds without it and the browser blocks the actual request.
 */
export const CORS_ALLOWED_HEADERS: string[] = [
  'Content-Type',
  'Authorization',
  'Accept',
  'X-Requested-With',
  'X-API-Key',
  'X-Guest-Session-Id',
];

export const corsOptions: CorsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // Allow storytimeapp.me and all subdomains
    const storytimePattern = /^https?:\/\/([a-z0-9-]+\.)*storytimeapp\.me$/;

    // Allow localhost for development
    const localhostPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

    if (storytimePattern.test(origin) || localhostPattern.test(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: CORS_ALLOWED_HEADERS,
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};
