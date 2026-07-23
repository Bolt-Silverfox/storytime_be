// CRITICAL: load .env into process.env BEFORE the observability imports below.
// otel-setup/sentry-setup read process.env at IMPORT time (before Nest's
// ConfigModule runs), so the OTLP/Grafana/Sentry vars must already be present
// or they silently fall back to no-op/console exporters. dotenv.config() does
// not override vars already set by pm2/the shell, so this is safe everywhere.
import 'dotenv/config';

// Observability must be initialized BEFORE any other imports.
// Sentry first so its OTel wiring is available when otel-setup builds the NodeSDK;
// both are SAFE NO-OPs when SENTRY_DSN / Grafana Cloud env vars are unset.
import { isSentryEnabled, captureException } from './sentry-setup';
import './otel-setup';
import { json, urlencoded } from 'express';

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { SuccessResponseInterceptor } from './shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from './shared/filters/prisma-exception.filter';
import { SentryExceptionFilter } from './shared/filters/sentry-exception.filter';
import { requestLogger } from './shared/middleware/request-logger.middleware';
import { swaggerCspDirectives } from './shared/config/security.config';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './shared/config/logger.config';

const bootstrapLogger = new Logger('Bootstrap');
const isProduction = process.env.NODE_ENV === 'production';

// Populated once bootstrap() creates the Nest app, so the process-signal and
// error handlers below can close it before the process exits.
let app: INestApplication | undefined;
let shuttingDown = false;

// Close the Nest app (which runs onModuleDestroy on every provider — e.g.
// PrismaService.$disconnect() and BullMQ teardown) BEFORE the process exits.
// A bare process.exit() bypasses enableShutdownHooks and orphans the open
// database connections; in dev's restart-on-save loop those leaked connections
// pile up until Postgres refuses new ones. A short unref'd timeout guarantees
// we still exit even if close() hangs.
const shutdown = async (code: number, reason: string): Promise<void> => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  bootstrapLogger.log(`Shutting down (${reason})`);
  const force = setTimeout(() => process.exit(code), 8000);
  force.unref();
  try {
    await app?.close();
  } catch (err) {
    bootstrapLogger.error('Error during graceful shutdown', err as Error);
  } finally {
    clearTimeout(force);
    process.exit(code);
  }
};

process.on('uncaughtException', (error: Error) => {
  captureException(error);
  bootstrapLogger.error(`Uncaught Exception: ${error.message}`, error.stack);
  void shutdown(1, 'uncaughtException');
});

process.on('unhandledRejection', (reason: unknown) => {
  captureException(reason);
  bootstrapLogger.error(
    `Unhandled Rejection at: Promise, reason: ${reason instanceof Error ? reason.message : String(reason)}`,
    reason instanceof Error ? reason.stack : undefined,
  );
  if (isProduction) {
    void shutdown(1, 'unhandledRejection');
  }
});

process.on('SIGTERM', () => {
  bootstrapLogger.log('SIGTERM received. Graceful shutdown initiated...');
  void shutdown(0, 'SIGTERM');
});

process.on('SIGINT', () => {
  bootstrapLogger.log('SIGINT received. Graceful shutdown initiated...');
  void shutdown(0, 'SIGINT');
});

async function bootstrap() {
  const logger = new Logger('Main');
  app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(winstonConfig),
  });

  // Run every provider's onModuleDestroy (PrismaService.$disconnect(), BullMQ
  // teardown, …) on SIGTERM/SIGINT and on the explicit app.close() in shutdown().
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // 1. GLOBAL SETUP (Prefix, CORS, Security, Compression)

  app.setGlobalPrefix('api/v1');

  // Enable gzip/deflate compression for responses > 1KB
  app.use(
    compression({
      filter: (req: any, res: any) => {
        // Don't compress if client doesn't accept it
        if (req.headers['x-no-compression']) {
          return false;
        }
        // Use compression's default filter (checks Accept-Encoding)
        return compression.filter(req, res);
      },
      threshold: 1024, // Only compress responses > 1KB
      level: 6, // Compression level (1-9, 6 is default balance of speed/ratio)
    }),
  );

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Strict default CSP (script-src 'self', object-src 'none', …) for the whole API.
  app.use(helmet());
  // Swagger UI (/docs) injects inline scripts/styles the strict CSP would block,
  // so relax the CSP ONLY for /docs. Registered AFTER the global helmet so it
  // overwrites the CSP header for /docs requests; all other routes stay strict.
  app.use(
    '/docs',
    helmet({ contentSecurityPolicy: { directives: swaggerCspDirectives } }),
  );
  app.use(requestLogger);
  app.enableCors({
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
      'X-API-Key',
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Enable global DTO/Payload validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Apply the SuccessResponseInterceptor globally for standardized output wrapping
  app.useGlobalInterceptors(new SuccessResponseInterceptor());

  // Get the HttpAdapterHost for registering global filters that require DI context
  const { httpAdapter } = app.get(HttpAdapterHost);

  // Sentry catch-all is registered FIRST so Nest gives it the LOWEST priority:
  // it only reports exceptions that no other filter handled, and preserves the
  // default error response. Only active when Sentry is enabled (SENTRY_DSN set),
  // so with no DSN the filter chain is unchanged.
  if (isSentryEnabled) {
    app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));
  }

  // Catch standard NestJS HttpExceptions (handles validation errors, 404s, etc.)
  app.useGlobalFilters(new HttpExceptionFilter());

  // Catch Prisma-specific exceptions and map them to appropriate HTTP responses
  app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

  // ==========================================================
  // 5. SWAGGER DOCUMENTATION
  // ==========================================================
  const config = new DocumentBuilder()
    .setTitle('Storytime API')
    .setDescription('The Storytime API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // ==========================================================
  // 6. START APPLICATION
  // ==========================================================
  await app.listen(port);
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(
    `Swagger documentation is available at: http://localhost:${port}/docs`,
  );
}

void bootstrap();
