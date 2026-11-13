import { PayloadTooLargeException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { UploadService } from './upload.service';
import { MAX_USER_UPLOAD_BYTES } from '@/shared/constants/upload.constants';

type Row = { userId: string; publicId: string; bytes: number };

function fakePrisma() {
  const rows: Row[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    userUpload: {
      aggregate: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve({
          _sum: {
            bytes:
              rows
                .filter((r) => r.userId === where.userId)
                .reduce((n, r) => n + r.bytes, 0) || null,
          },
        }),
      ),
      upsert: jest.fn(({ create }: { create: Row }) => {
        rows.push(create);
        return Promise.resolve(create);
      }),
    },
  };
  const prisma = {
    rows,
    tx,
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const before = rows.length;
      try {
        return await fn(tx);
      } catch (e) {
        rows.length = before;
        throw e;
      }
    }),
    userUpload: {
      deleteMany: jest.fn(({ where }: { where: { publicId: string } }) => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].publicId === where.publicId) rows.splice(i, 1);
        }
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  return prisma;
}

const file = (size: number) =>
  ({ buffer: Buffer.from('x'), size }) as Express.Multer.File;

describe('UploadService per-user upload cap', () => {
  const MB = 1024 * 1024;
  let prisma: ReturnType<typeof fakePrisma>;
  let service: UploadService;
  let uploads: jest.SpyInstance;

  const cloudinaryReplies = (publicId: string, bytes: number) =>
    uploads.mockImplementationOnce(((
      _opts: unknown,
      cb: (e: unknown, r?: unknown) => void,
    ) => {
      const stream = new PassThrough();
      stream.on('finish', () =>
        cb(undefined, { public_id: publicId, secure_url: 'u', bytes }),
      );
      stream.resume();
      return stream;
    }) as never);

  beforeEach(() => {
    prisma = fakePrisma();
    service = new UploadService(prisma as never);
    uploads = jest.spyOn(cloudinary.uploader, 'upload_stream');
  });

  afterEach(() => jest.restoreAllMocks());

  it('is a 200 MB cap by default', () => {
    expect(MAX_USER_UPLOAD_BYTES).toBe(200 * MB);
  });

  it("records the uploaded asset's publicId and bytes against the user", async () => {
    cloudinaryReplies('p1', 3 * MB);
    await service.uploadImage(file(5 * MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toEqual([
      { userId: 'u1', publicId: 'p1', bytes: 3 * MB },
    ]);
    expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses an upload that would pass the cap, before calling Cloudinary', async () => {
    prisma.rows.push({
      userId: 'u1',
      publicId: 'old',
      bytes: MAX_USER_UPLOAD_BYTES - 1 * MB,
    });
    await expect(
      service.uploadImage(file(2 * MB), 'avatars', { userId: 'u1' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(uploads).not.toHaveBeenCalled();
    expect(prisma.rows).toHaveLength(1);
  });

  it('allows an upload that lands exactly on the cap', async () => {
    prisma.rows.push({
      userId: 'u1',
      publicId: 'old',
      bytes: MAX_USER_UPLOAD_BYTES - 2 * MB,
    });
    cloudinaryReplies('p2', 2 * MB);
    await service.uploadImage(file(2 * MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toHaveLength(2);
  });

  it("does not count another user's uploads", async () => {
    prisma.rows.push({
      userId: 'u2',
      publicId: 'theirs',
      bytes: MAX_USER_UPLOAD_BYTES,
    });
    cloudinaryReplies('p3', MB);
    await service.uploadImage(file(MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toHaveLength(2);
  });

  it('leaves no counted row when the Cloudinary upload fails', async () => {
    uploads.mockImplementationOnce(((
      _opts: unknown,
      cb: (e: unknown) => void,
    ) => {
      const stream = new PassThrough();
      stream.on('finish', () => cb({ message: 'boom' }));
      stream.resume();
      return stream;
    }) as never);
    await expect(
      service.uploadImage(file(MB), 'avatars', { userId: 'u1' }),
    ).rejects.toThrow();
    expect(prisma.rows).toHaveLength(0);
  });

  it('frees the space when the image is deleted', async () => {
    prisma.rows.push({ userId: 'u1', publicId: 'gone', bytes: 10 * MB });
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    await service.deleteImage('gone');
    expect(prisma.rows).toHaveLength(0);
  });

  it('keeps the row when the Cloudinary delete fails', async () => {
    prisma.rows.push({ userId: 'u1', publicId: 'stays', bytes: 10 * MB });
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'not found' });
    await expect(service.deleteImage('stays')).rejects.toThrow();
    expect(prisma.rows).toHaveLength(1);
  });

  it('does not count or cap admin uploads', async () => {
    prisma.rows.push({
      userId: 'admin',
      publicId: 'big',
      bytes: MAX_USER_UPLOAD_BYTES,
    });
    cloudinaryReplies('p4', 5 * MB);
    await service.uploadImage(file(5 * MB), 'avatars', {
      userId: 'admin',
      exempt: true,
    });
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not count uploads with no owner (system uploads)', async () => {
    cloudinaryReplies('p5', 5 * MB);
    await service.uploadImage(file(5 * MB), 'categories');
    expect(prisma.rows).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('applies the cap to uploadFile as well', async () => {
    prisma.rows.push({
      userId: 'u1',
      publicId: 'old',
      bytes: MAX_USER_UPLOAD_BYTES,
    });
    await expect(
      service.uploadFile(file(1), { userId: 'u1' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(uploads).not.toHaveBeenCalled();
  });
});
