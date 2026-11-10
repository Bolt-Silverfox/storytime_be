import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '@/prisma/prisma.service';
import {
  FsPayloadStore,
  PrismaStoryStore,
} from './gutenberg-importer.adapters';

describe('FsPayloadStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpay-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes payload files 0600 in 0700 directories and reads them back', async () => {
    const store = new FsPayloadStore(path.join(dir, 'cache'));
    await store.write('gutenberg/1-abc.txt', 'raw text');
    const file = path.join(dir, 'cache', 'gutenberg', '1-abc.txt');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(await store.read('gutenberg/1-abc.txt')).toBe('raw text');
  });

  it('accepts keys under a filesystem-root cache dir and still rejects traversal', async () => {
    const store = new FsPayloadStore('/');
    await expect(store.read('gpay-missing-dir/b.txt')).rejects.toThrow(
      /ENOENT/,
    );
    await expect(store.read('../etc/passwd.txt')).rejects.toThrow(/Unsafe/);
  });

  describe('a symlinked payload directory', () => {
    let outside: string;
    let store: FsPayloadStore;
    beforeEach(() => {
      outside = path.join(dir, 'outside');
      fs.mkdirSync(outside);
      fs.mkdirSync(path.join(dir, 'cache'));
      fs.symlinkSync(outside, path.join(dir, 'cache', 'gutenberg'));
      store = new FsPayloadStore(path.join(dir, 'cache'));
    });

    it('is not written through', async () => {
      await expect(store.write('gutenberg/1-abc.txt', 'raw')).rejects.toThrow(
        /escapes/i,
      );
      expect(fs.readdirSync(outside)).toEqual([]);
    });

    it('is not read through', async () => {
      fs.writeFileSync(path.join(outside, '1-abc.txt'), 'planted');
      await expect(store.read('gutenberg/1-abc.txt')).rejects.toThrow(
        /escapes/i,
      );
    });
  });

  it('rejects unsafe keys', async () => {
    const store = new FsPayloadStore(dir);
    await expect(store.write('../x.txt', 'a')).rejects.toThrow(/unsafe/i);
    await expect(store.read('/etc/passwd')).rejects.toThrow(/unsafe/i);
  });
});

describe('PrismaStoryStore deleted rows', () => {
  const store = (row: Record<string, unknown>) => {
    const findFirst = jest.fn().mockResolvedValue(row);
    const prisma = { story: { findFirst } } as unknown as PrismaService;
    return { findFirst, store: new PrismaStoryStore(prisma) };
  };

  it('findBySource reports isDeleted instead of hiding the row', async () => {
    const { store: s } = store({
      id: 's1',
      contentHash: 'h',
      isPublished: false,
      isDeleted: true,
    });
    expect(await s.findBySource('1')).toEqual(
      expect.objectContaining({ id: 's1', isDeleted: true }),
    );
  });

  it('findByHash selects and returns isDeleted', async () => {
    const { store: s, findFirst } = store({ id: 's1', isDeleted: true });
    expect(await s.findByHash('h')).toEqual({ id: 's1', isDeleted: true });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ isDeleted: true }),
        orderBy: [{ isDeleted: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('findByHash prefers a live row over an older deleted one', async () => {
    const rows = [
      { id: 'z', isDeleted: false, createdAt: 0, contentHash: 'other' },
      { id: 'a', isDeleted: true, createdAt: 1, contentHash: 'h' },
      { id: 'b', isDeleted: false, createdAt: 2, contentHash: 'h' },
      { id: 'c', isDeleted: false, createdAt: 3, contentHash: 'h' },
    ];
    const findFirst = jest.fn(
      (args: {
        where: { contentHash: string };
        orderBy: Record<string, 'asc' | 'desc'>[];
      }) => {
        const num = (r: (typeof rows)[number], k: string) =>
          Number(r[k as keyof typeof r]);
        const sorted = rows
          .filter((r) => r.contentHash === args.where?.contentHash)
          .sort((x, y) => {
            for (const o of args.orderBy) {
              const [k] = Object.keys(o);
              const d = num(x, k) - num(y, k);
              if (d !== 0) return o[k] === 'asc' ? d : -d;
            }
            return 0;
          });
        return Promise.resolve(sorted[0] ?? null);
      },
    );
    const prisma = { story: { findFirst } } as unknown as PrismaService;
    expect(await new PrismaStoryStore(prisma).findByHash('h')).toEqual(
      expect.objectContaining({ id: 'b', isDeleted: false }),
    );
  });
});
