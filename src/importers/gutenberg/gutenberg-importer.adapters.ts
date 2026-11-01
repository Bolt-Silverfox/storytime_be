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
    if (!p.startsWith(this.root + path.sep))
      throw new Error('Payload key escapes root');
    return p;
  }
  async write(key: string, text: string): Promise<void> {
    const p = this.resolve(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, text, 'utf8');
    await fs.promises.rename(tmp, p);
  }
  read(key: string): Promise<string> {
    return fs.promises.readFile(this.resolve(key), 'utf8');
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
    opts: { ttlMs?: number; now?: Date },
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
      ? { id: s.id, contentHash: s.contentHash, isPublished: s.isPublished }
      : null;
  }

  async findByHash(hash: string) {
    const s = await this.prisma.story.findFirst({
      where: { contentHash: hash },
      select: { id: true },
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
