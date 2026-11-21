import * as fs from 'fs';
import * as path from 'path';
import { Prisma, SourceCache } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  SourceCacheService,
  SourceFetcher,
} from '@/source-cache/source-cache.service';
import {
  DuplicateStoryError,
  GutenbergCachePort,
  NewImportedStory,
  PayloadStore,
  SOURCE_NAME,
  StoryStorePort,
} from './gutenberg-importer';
import { isInsideRoot } from './gutenberg-source';

/** Raw payloads on local disk, content-addressed by the importer. Kept private. */
export class FsPayloadStore implements PayloadStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private resolve(key: string): string {
    if (!/^[a-z0-9][a-z0-9/_.-]*\.txt$/i.test(key) || key.includes('..')) {
      throw new Error(`Unsafe payload key: ${key}`);
    }
    const p = path.resolve(this.root, key);
    if (!isInsideRoot(this.root, p))
      throw new Error('Payload key escapes root');
    return p;
  }
  private async insideRoot(dir: string): Promise<string> {
    const [realRoot, realDir] = await Promise.all([
      fs.promises.realpath(this.root),
      fs.promises.realpath(dir),
    ]);
    if (realDir !== realRoot && !isInsideRoot(realRoot, realDir)) {
      throw new Error('Payload key escapes root');
    }
    return realDir;
  }
  async write(key: string, text: string): Promise<void> {
    const p = this.resolve(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    const target = path.join(
      await this.insideRoot(path.dirname(p)),
      path.basename(p),
    );
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.chmod(tmp, 0o600);
    await fs.promises.rename(tmp, target);
  }
  async read(key: string): Promise<string> {
    const p = this.resolve(key);
    const dir = await this.insideRoot(path.dirname(p));
    const handle = await fs.promises.open(
      path.join(dir, path.basename(p)),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  }
}

export class SourceCachePortImpl implements GutenbergCachePort {
  constructor(private readonly svc: SourceCacheService) {}
  peek(id: string): Promise<SourceCache | null> {
    return this.svc.get(SOURCE_NAME, id);
  }
  getOrFetch(
    id: string,
    fetcher: SourceFetcher,
    opts: { ttlMs?: number; now?: Date; force?: boolean },
  ) {
    return this.svc.getOrFetch(SOURCE_NAME, id, fetcher, {
      ...opts,
      fetchedBy: 'gutenberg-importer',
    });
  }
}

export class PrismaStoryStore implements StoryStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async findBySource(id: string) {
    // PrismaService omits contentHash by default; opt in explicitly.
    const s = await this.prisma.story.findFirst({
      where: { sourceName: SOURCE_NAME, sourceId: id },
      omit: { contentHash: false },
    });
    return s
      ? {
          id: s.id,
          contentHash: s.contentHash,
          isPublished: s.isPublished,
          isDeleted: s.isDeleted,
        }
      : null;
  }

  async findByHash(hash: string) {
    const s = await this.prisma.story.findFirst({
      where: { contentHash: hash },
      select: { id: true, isDeleted: true },
      orderBy: [{ isDeleted: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return s ?? null;
  }

  async resolveTaxonomy(categories: string[], themes: string[]) {
    const [cats, ths] = await Promise.all([
      this.prisma.category.findMany({
        where: { name: { in: categories }, isDeleted: false },
        select: { id: true, name: true },
      }),
      this.prisma.theme.findMany({
        where: { name: { in: themes }, isDeleted: false },
        select: { id: true, name: true },
      }),
    ]);
    const cn = new Set(cats.map((c) => c.name));
    const tn = new Set(ths.map((c) => c.name));
    return {
      categoryIds: cats.map((c) => c.id),
      themeIds: ths.map((c) => c.id),
      unmappedCategories: categories.filter((c) => !cn.has(c)),
      unmappedThemes: themes.filter((c) => !tn.has(c)),
    };
  }

  async create(d: NewImportedStory) {
    const { categoryIds, themeIds, ...rest } = d;
    try {
      const s = await this.prisma.story.create({
        data: {
          ...rest,
          categories: { connect: categoryIds.map((id) => ({ id })) },
          themes: { connect: themeIds.map((id) => ({ id })) },
        },
        select: { id: true },
      });
      return s;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new DuplicateStoryError();
      }
      throw e;
    }
  }
}
