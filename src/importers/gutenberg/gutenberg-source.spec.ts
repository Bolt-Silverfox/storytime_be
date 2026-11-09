import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FilesystemGutenbergSource,
  MAX_WORK_BYTES,
  isInsideRoot,
} from './gutenberg-source';

describe('FilesystemGutenbergSource', () => {
  let dir: string;
  const signal = new AbortController().signal;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsrc-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads a flat <id>-0.txt as utf8', async () => {
    fs.writeFileSync(path.join(dir, '123-0.txt'), 'café', 'utf8');
    const r = await new FilesystemGutenbergSource(dir).fetch('123', signal);
    expect(r).toMatchObject({ status: 200, text: 'café' });
  });

  it('reads the rsync mirror layout (digits as directories)', async () => {
    fs.mkdirSync(path.join(dir, '1', '2', '3', '1234'), { recursive: true });
    fs.writeFileSync(path.join(dir, '1/2/3/1234/1234-0.txt'), 'mirror');
    const r = await new FilesystemGutenbergSource(dir).fetch('1234', signal);
    expect(r).toMatchObject({ status: 200, text: 'mirror' });
  });

  it('decodes -8 files as latin1', async () => {
    fs.writeFileSync(path.join(dir, '55-8.txt'), Buffer.from([0x63, 0xe9]));
    const r = await new FilesystemGutenbergSource(dir).fetch('55', signal);
    expect(r).toMatchObject({ status: 200, text: 'cé' });
  });

  it('returns 404 when the work is not in the directory', async () => {
    const r = await new FilesystemGutenbergSource(dir).fetch('999', signal);
    expect(r.status).toBe(404);
  });

  it('rejects ids that are not plain digits (no path traversal)', async () => {
    const s = new FilesystemGutenbergSource(dir);
    await expect(s.fetch('../etc/passwd', signal)).rejects.toThrow(/id/i);
    await expect(s.fetch('12/34', signal)).rejects.toThrow(/id/i);
  });

  it('honours an aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      new FilesystemGutenbergSource(dir).fetch('1', ac.signal),
    ).rejects.toThrow(/abort/i);
  });

  it('refuses a missing or non-directory root', () => {
    expect(() => new FilesystemGutenbergSource('/definitely/not/here')).toThrow(
      /directory/i,
    );
  });

  it('skips a named pipe instead of blocking on it', async () => {
    execFileSync('mkfifo', [path.join(dir, '9-0.txt')]);
    const r = await new FilesystemGutenbergSource(dir).fetch('9', signal);
    expect(r.status).toBe(404);
  }, 3000);

  it('refuses a file larger than the cap', async () => {
    fs.writeFileSync(path.join(dir, '7-0.txt'), '');
    fs.truncateSync(path.join(dir, '7-0.txt'), MAX_WORK_BYTES + 1);
    await expect(
      new FilesystemGutenbergSource(dir).fetch('7', signal),
    ).rejects.toThrow(/exceeds/);
  });

  it('refuses a file that grew past the cap after it was measured', async () => {
    const file = path.join(dir, '8-0.txt');
    fs.writeFileSync(file, '');
    fs.truncateSync(file, MAX_WORK_BYTES + 10);
    const real = jest.requireActual<typeof fs>('fs');
    const original = real.fstatSync;
    const fstat = jest.spyOn(real, 'fstatSync').mockImplementation(((
      fd: number,
    ) =>
      Object.assign(Object.create(original(fd) as object) as object, {
        size: 10,
      })) as typeof fs.fstatSync);
    try {
      await expect(
        new FilesystemGutenbergSource(dir).fetch('8', signal),
      ).rejects.toThrow(/exceeds/);
    } finally {
      fstat.mockRestore();
    }
  });
});

describe('isInsideRoot', () => {
  it.each([
    ['/', '/a/b', true],
    ['/r', '/r/a', true],
    ['/r', '/rx/a', false],
    ['/r', '/r', false],
    ['/r/s', '/r/x', false],
    ['/r', '/other', false],
  ])('root %s, path %s -> %s', (root, p, expected) => {
    expect(isInsideRoot(root, p)).toBe(expected);
  });
});
