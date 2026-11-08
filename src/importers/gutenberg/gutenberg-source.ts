import * as fs from 'fs';
import * as path from 'path';

export type GutenbergFetchResult =
  | {
      status: 200;
      text: string;
      sourceUrl?: string | null;
      lastModified?: string | null;
    }
  | { status: 404 };

/**
 * Where raw works come from. Implementations must read an official mirror or a
 * local copy; scraping gutenberg.org pages at runtime is not allowed. A future
 * HTTPS/rsync implementation must be https-only with byte limits, content-type
 * check, timeouts and must honour `signal` (see docs/importers/gutenberg.md).
 */
export interface GutenbergSource {
  fetch(id: string, signal: AbortSignal): Promise<GutenbergFetchResult>;
}

export const MAX_WORK_BYTES = 8 * 1024 * 1024;
const ID = /^\d{1,7}$/;

export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

export class FilesystemGutenbergSource implements GutenbergSource {
  private readonly root: string;

  constructor(dir: string) {
    let real: string;
    try {
      real = fs.realpathSync(dir);
      if (!fs.statSync(real).isDirectory()) throw new Error('x');
    } catch {
      throw new Error(`Source path is not a readable directory: ${dir}`);
    }
    this.root = real;
  }

  /** Flat layouts, rsync mirror layout (digits as dirs) and cache/epub layout. */
  private candidates(id: string): { file: string; latin1: boolean }[] {
    const nested =
      id.length === 1 ? ['0', id] : [...id.slice(0, -1).split(''), id];
    const dirs = [
      this.root,
      path.join(this.root, id),
      path.join(this.root, ...nested),
      path.join(this.root, 'cache', 'epub', id),
    ];
    const names: [string, boolean][] = [
      [`${id}-0.txt`, false],
      [`${id}.txt`, false],
      [`pg${id}.txt`, false],
      [`${id}-8.txt`, true],
    ];
    return dirs.flatMap((d) =>
      names.map(([n, latin1]) => ({ file: path.join(d, n), latin1 })),
    );
  }

  fetch(id: string, signal: AbortSignal): Promise<GutenbergFetchResult> {
    if (!ID.test(id)) {
      return Promise.reject(new Error(`Invalid ebook id: ${id}`));
    }
    if (signal.aborted) return Promise.reject(new Error('Fetch aborted'));
    for (const c of this.candidates(id)) {
      let real: string;
      try {
        real = fs.realpathSync(c.file);
      } catch {
        continue;
      }
      if (!isInsideRoot(this.root, real)) continue; // symlink escape
      let fd: number;
      try {
        fd = fs.openSync(real, 'r');
      } catch {
        continue;
      }
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) continue;
        const tooBig = () =>
          Promise.reject(
            new Error(`Work ${id} exceeds ${MAX_WORK_BYTES} bytes`),
          );
        if (st.size > MAX_WORK_BYTES) return tooBig();
        const buf = Buffer.allocUnsafe(MAX_WORK_BYTES + 1);
        let len = 0;
        while (len < buf.length) {
          const n = fs.readSync(fd, buf, len, buf.length - len, null);
          if (n === 0) break;
          len += n;
        }
        if (len > MAX_WORK_BYTES) return tooBig();
        return Promise.resolve({
          status: 200,
          text: buf.toString(c.latin1 ? 'latin1' : 'utf8', 0, len),
          sourceUrl: null,
          lastModified: st.mtime.toISOString(),
        });
      } finally {
        fs.closeSync(fd);
      }
    }
    return Promise.resolve({ status: 404 });
  }
}
