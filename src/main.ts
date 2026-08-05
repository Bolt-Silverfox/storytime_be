import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { SuccessResponseInterceptor } from './shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from './shared/filters/prisma-exception.filter';
import { ThrottlerExceptionFilter } from './shared/filters/throttler-exception.filter';
import { requestLogger } from './shared/middleware/request-logger.middleware';

async function bootstrap() {
  const logger = new Logger('Main');
  // Declared before the error handlers + shutdown closure below (which reference
  // it) so a failure during NestFactory.create is still caught and closed
  // gracefully. This is a genuine read-before-assign, which prefer-const misflags.
  // eslint-disable-next-line prefer-const
  let app: INestApplication | undefined;
  let shuttingDown = false;

  // Close the Nest app (which runs onModuleDestroy on every provider — e.g.
  // PrismaService.$disconnect() and BullMQ teardown) BEFORE the process exits.
  // A bare process.exit() bypasses enableShutdownHooks and orphans the open
  // database connections; in dev's restart-on-save loop those leaked
  // connections pile up until Postgres refuses new ones. A short unref'd
  // timeout guarantees we still exit even if close() hangs.
  const shutdown = async (code: number, reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log(`Shutting down (${reason})`);
    const force = setTimeout(() => process.exit(code), 8000);
    force.unref();
    try {
      await app?.close();
    } catch (err) {
      logger.error('Error during graceful shutdown', err as Error);
    } finally {
      clearTimeout(force);
      process.exit(code);
    }
  };

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', reason);
    void shutdown(1, 'unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error);
    void shutdown(1, 'uncaughtException');
  });

  app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // 1. GLOBAL SETUP (Prefix, CORS, Security)

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
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
      'X-Guest-Session-Id',
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

  // Catch standard NestJS HttpExceptions (handles validation errors, 404s, etc.)
  app.useGlobalFilters(new HttpExceptionFilter());
  // Registered after HttpExceptionFilter so it takes precedence for
  // ThrottlerException (429) and returns a clean, premium-aware message
  // instead of the raw "ThrottlerException: Too Many Requests".
  app.useGlobalFilters(new ThrottlerExceptionFilter());

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

  // Graceful shutdown
  app.enableShutdownHooks();

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
