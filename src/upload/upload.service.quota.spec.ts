import { PayloadTooLargeException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { UploadService } from './upload.service';
import { MAX_USER_UPLOAD_BYTES } from '@/shared/constants/upload.constants';

type Row = {
  id: string;
  userId: string;
  publicId: string | null;
  bytes: number;
  pending: boolean;
  createdAt: Date;
};

type Where = {
  id?: string;
  userId?: string;
  publicId?: string;
  pending?: boolean;
  createdAt?: { lt: Date };
  NOT?: { id: string };
};

const MB = 1024 * 1024;

function fakePrisma() {
  const rows: Row[] = [];
  const state = { openTx: 0, seq: 0 };
  const matches = (r: Row, w: Where) =>
    (w.id === undefined || r.id === w.id) &&
    (w.userId === undefined || r.userId === w.userId) &&
    (w.publicId === undefined || r.publicId === w.publicId) &&
    (w.pending === undefined || r.pending === w.pending) &&
    (w.createdAt === undefined || r.createdAt < w.createdAt.lt) &&
    (w.NOT === undefined || r.id !== w.NOT.id);

  const userUpload = {
    deleteMany: jest.fn(({ where }: { where: Where }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return Promise.resolve({ count });
    }),
    aggregate: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve({
        _sum: {
          bytes:
            rows
              .filter((r) => matches(r, where))
              .reduce((n, r) => n + r.bytes, 0) || null,
        },
      }),
    ),
    create: jest.fn(
      ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'publicId'> }) => {
        const row: Row = {
          ...data,
          id: `row${++state.seq}`,
          publicId: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return Promise.resolve({ id: row.id });
      },
    ),
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return Promise.reject(new Error('row missing'));
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    ),
  };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(1), userUpload };
  const prisma = {
    rows,
    state,
    tx,
    userUpload,
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      state.openTx++;
      try {
        return await (arg as (t: typeof tx) => Promise<unknown>)(tx);
      } finally {
        state.openTx--;
      }
    }),
  };
  return prisma;
}

const file = (size: number) =>
  ({ buffer: Buffer.from('x'), size }) as Express.Multer.File;

describe('UploadService per-user upload cap', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: UploadService;
  let uploads: jest.SpyInstance;
  let openTxDuringUpload: number[];

  const seed = (r: Partial<Row> & { userId: string; bytes: number }) =>
    prisma.rows.push({
      id: `seed${prisma.rows.length}`,
      publicId: `seed-${prisma.rows.length}`,
      pending: false,
      createdAt: new Date(),
      ...r,
    });

  const cloudinaryReplies = (publicId: string, bytes: number) =>
    uploads.mockImplementationOnce(((
      _opts: unknown,
      cb: (e: unknown, r?: unknown) => void,
    ) => {
      openTxDuringUpload.push(prisma.state.openTx);
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
    openTxDuringUpload = [];
  });

  afterEach(() => jest.restoreAllMocks());

  it('is a 200 MB cap by default', () => {
    expect(MAX_USER_UPLOAD_BYTES).toBe(200 * MB);
  });

  it("records the uploaded asset's publicId and bytes against the user", async () => {
    cloudinaryReplies('p1', 3 * MB);
    await service.uploadImage(file(5 * MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toMatchObject([
      { userId: 'u1', publicId: 'p1', bytes: 3 * MB, pending: false },
    ]);
  });

  it('holds no transaction or lock while Cloudinary is called', async () => {
    cloudinaryReplies('p1', MB);
    await service.uploadImage(file(MB), 'avatars', { userId: 'u1' });
    expect(openTxDuringUpload).toEqual([0]);
    expect(prisma.rows[0].pending).toBe(false);
  });

  it('reserves the incoming size while the upload is in flight', async () => {
    let reservedDuringUpload = 0;
    uploads.mockImplementationOnce(((
      _opts: unknown,
      cb: (e: unknown, r?: unknown) => void,
    ) => {
      reservedDuringUpload = prisma.rows
        .filter((r) => r.pending)
        .reduce((n, r) => n + r.bytes, 0);
      const stream = new PassThrough();
      stream.on('finish', () =>
        cb(undefined, { public_id: 'p', secure_url: 'u', bytes: MB }),
      );
      stream.resume();
      return stream;
    }) as never);
    await service.uploadImage(file(5 * MB), 'avatars', { userId: 'u1' });
    expect(reservedDuringUpload).toBe(5 * MB);
  });

  it('refuses an upload that would pass the cap, before calling Cloudinary', async () => {
    seed({ userId: 'u1', bytes: MAX_USER_UPLOAD_BYTES - MB });
    await expect(
      service.uploadImage(file(2 * MB), 'avatars', { userId: 'u1' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(uploads).not.toHaveBeenCalled();
    expect(prisma.rows).toHaveLength(1);
  });

  it('answers a refusal with a machine-readable quota code and the same message', async () => {
    seed({ userId: 'u1', bytes: MAX_USER_UPLOAD_BYTES });
    const error = await service
      .uploadImage(file(1), 'avatars', { userId: 'u1' })
      .catch((e: PayloadTooLargeException) => e);
    expect((error as PayloadTooLargeException).getResponse()).toEqual({
      statusCode: 413,
      error: 'UPLOAD_QUOTA_EXCEEDED',
      code: 'UPLOAD_QUOTA_EXCEEDED',
      message:
        'Upload storage limit reached. Delete some uploads and try again.',
    });
  });

  it('allows an upload that lands exactly on the cap', async () => {
    seed({ userId: 'u1', bytes: MAX_USER_UPLOAD_BYTES - 2 * MB });
    cloudinaryReplies('p2', 2 * MB);
    await service.uploadImage(file(2 * MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toHaveLength(2);
  });

  it("does not count another user's uploads", async () => {
    seed({ userId: 'u2', bytes: MAX_USER_UPLOAD_BYTES });
    cloudinaryReplies('p3', MB);
    await service.uploadImage(file(MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toHaveLength(2);
  });

  it('counts a fresh pending reservation against the cap', async () => {
    seed({
      userId: 'u1',
      bytes: MAX_USER_UPLOAD_BYTES,
      pending: true,
      publicId: null,
    });
    await expect(
      service.uploadImage(file(1), 'avatars', { userId: 'u1' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('sweeps stale pending reservations when it reserves', async () => {
    seed({
      userId: 'u1',
      bytes: MAX_USER_UPLOAD_BYTES,
      pending: true,
      publicId: null,
      createdAt: new Date(Date.now() - 16 * 60_000),
    });
    cloudinaryReplies('p6', MB);
    await service.uploadImage(file(MB), 'avatars', { userId: 'u1' });
    expect(prisma.rows).toMatchObject([{ publicId: 'p6', pending: false }]);
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

  it('removes the reservation and the asset when recording the upload fails', async () => {
    cloudinaryReplies('p7', MB);
    prisma.userUpload.update.mockRejectedValueOnce(new Error('db down'));
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    await expect(
      service.uploadImage(file(MB), 'avatars', { userId: 'u1' }),
    ).rejects.toThrow('db down');
    expect(destroy).toHaveBeenCalledWith('p7');
    expect(prisma.rows).toHaveLength(0);
  });

  it('logs a warning when destroying the asset after a failed record also fails', async () => {
    cloudinaryReplies('p8', MB);
    prisma.userUpload.update.mockRejectedValueOnce(new Error('db down'));
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockRejectedValue(new Error('cdn down'));
    const warn = jest
      .spyOn(
        (service as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    await expect(
      service.uploadImage(file(MB), 'avatars', { userId: 'u1' }),
    ).rejects.toThrow('db down');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('p8'));
  });

  it('deletes a non-image asset with its resource type and frees the row', async () => {
    seed({ userId: 'u1', bytes: 4 * MB, publicId: 'voice-1' });
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    await service.deleteImage('voice-1', 'video');
    expect(destroy).toHaveBeenCalledWith('voice-1', { resource_type: 'video' });
    expect(prisma.rows).toHaveLength(0);
  });

  it('frees the space when the image is deleted', async () => {
    seed({ userId: 'u1', bytes: 10 * MB, publicId: 'gone' });
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    await service.deleteImage('gone');
    expect(prisma.rows).toHaveLength(0);
  });

  it('keeps the row when the Cloudinary delete fails', async () => {
    seed({ userId: 'u1', bytes: 10 * MB, publicId: 'stays' });
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'not found' });
    await expect(service.deleteImage('stays')).rejects.toThrow();
    expect(prisma.rows).toHaveLength(1);
  });

  it('does not count or cap admin uploads', async () => {
    seed({ userId: 'admin', bytes: MAX_USER_UPLOAD_BYTES });
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
    seed({ userId: 'u1', bytes: MAX_USER_UPLOAD_BYTES });
    await expect(
      service.uploadFile(file(1), { userId: 'u1' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(uploads).not.toHaveBeenCalled();
  });
});
