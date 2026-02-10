import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { SuccessResponseInterceptor } from './shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from './shared/filters/prisma-exception.filter';
import { requestLogger } from './shared/middleware/request-logger.middleware';

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

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
