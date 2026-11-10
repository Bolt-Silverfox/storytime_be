import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { UploadModule } from './upload.module';
import { UploadService } from './upload.service';

describe('UploadModule', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        UploadModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not expose POST /upload', async () => {
    await request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.from('<html></html>'), {
        filename: 'x.html',
        contentType: 'text/html',
      })
      .expect(404);
  });

  it('still provides UploadService to other modules', () => {
    expect(app.get(UploadService)).toBeInstanceOf(UploadService);
  });
});
