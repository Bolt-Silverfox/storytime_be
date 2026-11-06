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
      }),
    );
  });
});
