import { Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { OrphanedUploadReconciler } from './orphaned-upload-reconciler.service';
import {
  PENDING_UPLOAD_TAG,
  RESERVATION_CONTEXT_KEY,
  UploadService,
} from './upload.service';

type Row = {
  id: string;
  userId: string;
  publicId: string | null;
  bytes: number;
  pending: boolean;
};

type Where = { id?: string; publicId?: string; pending?: boolean };

type Asset = {
  public_id: string;
  resource_type: string;
  created_at: string;
  context?: { custom?: Record<string, string> };
};

const MINUTE = 60_000;
const NOW = Date.parse('2026-11-20T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW - n * MINUTE).toISOString();

function fakePrisma() {
  const rows: Row[] = [];
  const matches = (r: Row, w: Where) =>
    (w.id === undefined || r.id === w.id) &&
    (w.publicId === undefined || r.publicId === w.publicId) &&
    (w.pending === undefined || r.pending === w.pending);
  return {
    rows,
    avatar: { count: jest.fn().mockResolvedValue(0) },
    voice: { count: jest.fn().mockResolvedValue(0) },
    story: { count: jest.fn().mockResolvedValue(0) },
    userUpload: {
      findFirst: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
      ),
      deleteMany: jest.fn(({ where }: { where: Where }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (matches(rows[i], where)) rows.splice(i, 1);
        }
        return Promise.resolve({ count: before - rows.length });
      }),
    },
  };
}

describe('OrphanedUploadReconciler', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let reconciler: OrphanedUploadReconciler;
  let list: jest.SpyInstance;
  let destroy: jest.SpyInstance;
  let removeTag: jest.SpyInstance;
  let tagged: Asset[];

  const asset = (
    publicId: string,
    ageMinutes: number,
    reservationId?: string,
    resourceType = 'image',
  ): Asset => ({
    public_id: publicId,
    resource_type: resourceType,
    created_at: minutesAgo(ageMinutes),
    context: reservationId
      ? { custom: { [RESERVATION_CONTEXT_KEY]: reservationId } }
      : undefined,
  });

  beforeEach(() => {
    prisma = fakePrisma();
    reconciler = new OrphanedUploadReconciler(
      prisma as never,
      new UploadService(prisma as never),
    );
    tagged = [];
    list = jest.spyOn(cloudinary.api, 'resources_by_tag').mockImplementation(((
      _tag: string,
      opts: { resource_type: string },
    ) =>
      Promise.resolve({
        resources: tagged.filter((a) => a.resource_type === opts.resource_type),
      })) as never);
    destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    removeTag = jest
      .spyOn(cloudinary.uploader, 'remove_tag')
      .mockResolvedValue({});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('destroys a pending-tagged asset that no upload row records', async () => {
    tagged.push(asset('orphan', 45, 'reaped'));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).toHaveBeenCalledWith('orphan', { resource_type: 'image' });
    expect(summary).toEqual({ destroyed: 1, cleared: 0, kept: 0, failed: 0 });
  });

  it('releases the reservation left pending by the failed upload', async () => {
    prisma.rows.push(
      { id: 'res1', userId: 'u1', publicId: null, bytes: 5, pending: true },
      { id: 'other', userId: 'u1', publicId: 'kept', bytes: 7, pending: false },
    );
    tagged.push(asset('orphan', 45, 'res1'));

    await reconciler.reconcile(NOW);

    expect(prisma.rows.map((r) => r.id)).toEqual(['other']);
  });

  it('asks Cloudinary for the pending tag in every resource type', async () => {
    tagged.push(asset('clip', 45, undefined, 'video'));
    tagged.push(asset('doc', 45, undefined, 'raw'));

    await reconciler.reconcile(NOW);

    expect(list.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      PENDING_UPLOAD_TAG,
      PENDING_UPLOAD_TAG,
      PENDING_UPLOAD_TAG,
    ]);
    expect(destroy).toHaveBeenCalledWith('clip', { resource_type: 'video' });
    expect(destroy).toHaveBeenCalledWith('doc', { resource_type: 'raw' });
  });

  it('leaves an asset alone while its upload may still be in flight', async () => {
    tagged.push(asset('fresh', 29, 'res1'));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).not.toHaveBeenCalled();
    expect(removeTag).not.toHaveBeenCalled();
    expect(summary).toEqual({ destroyed: 0, cleared: 0, kept: 0, failed: 0 });
  });

  it('clears the tag from a recorded asset instead of destroying it', async () => {
    prisma.rows.push({
      id: 'res1',
      userId: 'u1',
      publicId: 'recorded',
      bytes: 5,
      pending: false,
    });
    tagged.push(asset('recorded', 45, 'res1', 'video'));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).not.toHaveBeenCalled();
    expect(removeTag).toHaveBeenCalledWith(PENDING_UPLOAD_TAG, ['recorded'], {
      resource_type: 'video',
    });
    expect(prisma.rows).toHaveLength(1);
    expect(summary).toEqual({ destroyed: 0, cleared: 1, kept: 0, failed: 0 });
  });

  it('destroys nothing when the database cannot be read', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prisma.userUpload.findFirst.mockRejectedValue(new Error('db down'));
    prisma.userUpload.deleteMany.mockRejectedValue(new Error('db down'));
    tagged.push(asset('unknown', 45, 'res1'));
    tagged.push(asset('untracked', 45));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).not.toHaveBeenCalled();
    expect(removeTag).not.toHaveBeenCalled();
    expect(summary).toEqual({ destroyed: 0, cleared: 0, kept: 0, failed: 2 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown'));
  });

  it('keeps an unrecorded asset that an avatar still points at', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    prisma.avatar.count.mockResolvedValue(1);
    prisma.rows.push({
      id: 'res1',
      userId: 'u1',
      publicId: null,
      bytes: 5,
      pending: true,
    });
    tagged.push(asset('in-use', 45, 'res1'));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).not.toHaveBeenCalled();
    expect(summary).toEqual({ destroyed: 0, cleared: 0, kept: 1, failed: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('in-use'));
  });

  it('counts an asset Cloudinary no longer has as destroyed', async () => {
    destroy.mockResolvedValue({ result: 'not found' });
    prisma.rows.push({
      id: 'res1',
      userId: 'u1',
      publicId: null,
      bytes: 5,
      pending: true,
    });
    tagged.push(asset('gone', 45, 'res1'));

    const summary = await reconciler.reconcile(NOW);

    expect(prisma.rows).toHaveLength(0);
    expect(summary).toEqual({ destroyed: 1, cleared: 0, kept: 0, failed: 0 });
  });

  it('carries on with the remaining assets when one destroy fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    destroy
      .mockRejectedValueOnce(new Error('cloudinary 500'))
      .mockResolvedValueOnce({ result: 'ok' });
    tagged.push(asset('stuck', 45, 'res1'), asset('orphan', 45, 'res2'));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).toHaveBeenCalledWith('orphan', { resource_type: 'image' });
    expect(summary).toEqual({ destroyed: 1, cleared: 0, kept: 0, failed: 1 });
  });

  it('releases the reservation before it looks for a record, so a late finalise cannot commit behind the lookup', async () => {
    prisma.rows.push({
      id: 'res1',
      userId: 'u1',
      publicId: null,
      bytes: 5,
      pending: true,
    });
    let reservationAtLookup: Row | undefined;
    const lookup = prisma.userUpload.findFirst.getMockImplementation()!;
    prisma.userUpload.findFirst.mockImplementation((args) => {
      reservationAtLookup = prisma.rows.find((r) => r.id === 'res1');
      return lookup(args);
    });
    tagged.push(asset('orphan', 45, 'res1'));

    await reconciler.reconcile(NOW);

    expect(prisma.userUpload.findFirst).toHaveBeenCalled();
    expect(reservationAtLookup).toBeUndefined();
  });

  it('follows the listing cursor past a page of assets it keeps', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.avatar.count.mockResolvedValueOnce(1);
    list.mockImplementation(((
      _tag: string,
      opts: { resource_type: string; next_cursor?: string },
    ) => {
      if (opts.resource_type !== 'image') {
        return Promise.resolve({ resources: [] });
      }
      return Promise.resolve(
        opts.next_cursor === 'page2'
          ? { resources: [asset('orphan', 45)] }
          : { resources: [asset('in-use', 45)], next_cursor: 'page2' },
      );
    }) as never);

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).toHaveBeenCalledWith('orphan', { resource_type: 'image' });
    expect(summary).toEqual({ destroyed: 1, cleared: 0, kept: 1, failed: 0 });
  });

  it('still reconciles the other resource types when one cannot be listed', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    list.mockImplementation(((_tag: string, opts: { resource_type: string }) =>
      opts.resource_type === 'image'
        ? Promise.reject(new Error('rate limited'))
        : Promise.resolve({
            resources: tagged.filter(
              (a) => a.resource_type === opts.resource_type,
            ),
          })) as never);
    tagged.push(asset('clip', 45, undefined, 'video'));

    const summary = await reconciler.reconcile(NOW);

    expect(destroy).toHaveBeenCalledWith('clip', { resource_type: 'video' });
    expect(summary).toEqual({ destroyed: 1, cleared: 0, kept: 0, failed: 0 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('image'));
  });

  it('does not release a reservation that has since been recorded for another asset', async () => {
    prisma.rows.push({
      id: 'res1',
      userId: 'u1',
      publicId: 'newer',
      bytes: 5,
      pending: false,
    });
    tagged.push(asset('orphan', 45, 'res1'));

    await reconciler.reconcile(NOW);

    expect(destroy).toHaveBeenCalledWith('orphan', { resource_type: 'image' });
    expect(prisma.rows).toHaveLength(1);
  });

  it('survives a scheduled run in which Cloudinary cannot be listed', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    list.mockRejectedValue(new Error('rate limited'));

    await expect(reconciler.reconcileOnSchedule()).resolves.toBeUndefined();

    expect(destroy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
  });
});
