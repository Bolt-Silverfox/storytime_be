import { PayloadTooLargeException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from './upload.service';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('user_uploads (real Postgres)', () => {
  const MB = 1024 * 1024;
  const prisma = new PrismaService();
  const raw = new PrismaClient();
  const service = new UploadService(prisma);
  const tag = `upl_${Date.now()}`;
  let userId: string;
  let counter = 0;

  const file = (size: number) =>
    ({ buffer: Buffer.from('x'), size }) as Express.Multer.File;

  beforeEach(async () => {
    const user = await raw.user.create({
      data: { email: `${tag}_${counter++}@example.com`, passwordHash: 'x' },
    });
    userId = user.id;
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((
      _o: unknown,
      cb: (e: unknown, r?: unknown) => void,
    ) => {
      const stream = new PassThrough();
      stream.on('finish', () =>
        setTimeout(
          () =>
            cb(undefined, {
              public_id: `${tag}_${Math.random()}`,
              secure_url: 'u',
              bytes: 120 * MB,
            }),
          50,
        ),
      );
      stream.resume();
      return stream;
    }) as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await raw.user.deleteMany({ where: { email: { startsWith: tag } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await raw.$disconnect();
  });

  it('lets only one of two parallel uploads past the cap', async () => {
    const owner = { userId };
    const results = await Promise.allSettled([
      service.uploadImage(file(120 * MB), 'avatars', owner),
      service.uploadImage(file(120 * MB), 'avatars', owner),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(await raw.userUpload.count({ where: { userId } })).toBe(1);
  });

  it('frees space on delete so the next upload fits again', async () => {
    const owner = { userId };
    const first = await service.uploadImage(file(120 * MB), 'avatars', owner);
    await expect(
      service.uploadImage(file(120 * MB), 'avatars', owner),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    await service.deleteImage(first.public_id);
    await service.uploadImage(file(120 * MB), 'avatars', owner);
    expect(await raw.userUpload.count({ where: { userId } })).toBe(1);
  });

  it('sweeps a stale pending reservation but honours a fresh one', async () => {
    const owner = { userId };
    await raw.userUpload.create({
      data: { userId, bytes: 150 * MB, pending: true },
    });
    await expect(
      service.uploadImage(file(120 * MB), 'avatars', owner),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    await raw.userUpload.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    await service.uploadImage(file(120 * MB), 'avatars', owner);
    expect(await raw.userUpload.count({ where: { userId } })).toBe(1);
    expect(
      await raw.userUpload.count({ where: { userId, pending: true } }),
    ).toBe(0);
  });

  it('keeps publicId unique and cascades on user delete', async () => {
    await raw.userUpload.create({
      data: { userId, publicId: `${tag}_dup`, bytes: 1 },
    });
    await expect(
      raw.userUpload.create({
        data: { userId, publicId: `${tag}_dup`, bytes: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await raw.user.delete({ where: { id: userId } });
    expect(await raw.userUpload.count({ where: { userId } })).toBe(0);
  });
});
