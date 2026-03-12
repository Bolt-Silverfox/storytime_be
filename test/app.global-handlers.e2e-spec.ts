import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Module,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { IsString, IsNotEmpty } from 'class-validator';
import { SuccessResponseInterceptor } from '../src/shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from '../src/shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter';
import { Server } from 'http';

// --- Minimal test fixtures (no env vars needed) ---

class TestLoginDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

@Controller('auth')
class TestController {
  @Get('test-success')
  testSuccess() {
    return { hello: 'world' };
  }

  @Post('login')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  login(@Body() _dto: TestLoginDto) {
    return { token: 'fake' };
  }

  @Get('conflict')
  conflict() {
    throw new HttpException(
      { message: 'The email is already in use.', error: 'Conflict' },
      HttpStatus.CONFLICT,
    );
  }
}

@Module({
  controllers: [TestController],
})
class TestAppModule {}

// --- Tests ---

describe('Global Handlers (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // 1. Apply Global Interceptor
    app.useGlobalInterceptors(new SuccessResponseInterceptor());

    // 2. Apply Global Filters
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

    // 3. Apply Global Validation Pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.setGlobalPrefix('api/v1');

    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // Helper function to check the standardized error response format
  const expectErrorFormat = (
    res: request.Response,
    status: number,
    errorTitle: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(status);
    expect(res.body.error).toBe(errorTitle);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('path');
  };

  const expectSuccessFormat = (res: request.Response, status: number) => {
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(true);
    expect(res.body.statusCode).toBe(status);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('Request completed successfully.');
  };

  describe('SuccessResponseInterceptor', () => {
    it('should wrap successful GET request data into the standard success format', async () => {
      const res = await request(server).get('/api/v1/auth/test-success');
      expectSuccessFormat(res, 200);
      expect(res.body.data).toEqual({ hello: 'world' });
    });
  });

  describe('HttpExceptionFilter', () => {
    it('should catch unhandled 404s and format them correctly', async () => {
      const res = await request(server).get('/api/v1/a-non-existent-route-999');

      expectErrorFormat(res, 404, 'Not Found');
      expect(res.body.message).toEqual(
        'Cannot GET /api/v1/a-non-existent-route-999',
      );
    });

    it('should format custom thrown HttpException (409 Conflict)', async () => {
      const res = await request(server).get('/api/v1/auth/conflict');

      expectErrorFormat(res, 409, 'Conflict');
      expect(res.body.message).toBe('The email is already in use.');
    });
  });

  describe('ValidationPipe Integration', () => {
    it('should catch DTO validation errors and format them as 400 Bad Request', async () => {
      const res = await request(server).post('/api/v1/auth/login').send({});

      expectErrorFormat(res, 400, 'Bad Request');
      expect(Array.isArray(res.body.message)).toBe(true);
    });
  });
});
