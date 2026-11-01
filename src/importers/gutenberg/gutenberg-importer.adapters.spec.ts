import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FsPayloadStore } from './gutenberg-importer.adapters';

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
