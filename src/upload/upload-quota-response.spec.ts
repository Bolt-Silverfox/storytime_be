import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { HttpExceptionFilter } from '@/shared/filters/http-exception.filter';
import { MAX_USER_UPLOAD_BYTES } from '@/shared/constants/upload.constants';

describe('upload quota response body', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      userUpload: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { bytes: MAX_USER_UPLOAD_BYTES } }),
      },
    };
    const prisma = {
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [UploadService, { provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          ctx.switchToHttp().getRequest().authUserData = {
            userId: 'u1',
            userRole: 'parent',
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  it('keeps the machine-readable code and the message through the exception filter', async () => {
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/upload')
      .attach('file', Buffer.from('data'), 'a.txt')
      .expect(413);
    expect(res.body).toMatchObject({
      statusCode: 413,
      error: 'UPLOAD_QUOTA_EXCEEDED',
      code: 'UPLOAD_QUOTA_EXCEEDED',
      message:
        'Upload storage limit reached. Delete some uploads and try again.',
    });
  });
});
