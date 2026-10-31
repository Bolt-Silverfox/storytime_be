import { Injectable } from '@nestjs/common';
import type { Prisma, SceneImageStatus, StorySceneImage } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IStorySceneRepository,
  ScenePlan,
  SceneWithStory,
} from './scene.repository.interface';

const withStory = {
  story: { select: { id: true, title: true, textContent: true } },
} as const;

/** How long a redefinition waits for the per-story lock before giving up. */
const LOCK_TIMEOUT_MS = 5000;

/** Interactive-transaction timeout for a redefinition (statements run sequentially). */
const TX_TIMEOUT_MS = 30_000;

/** Temporary index for kept rows while they swap places (unique key safety). */
const TEMP_INDEX_OFFSET = 1_000_000;

@Injectable()
export class PrismaStorySceneRepository implements IStorySceneRepository {
  /** Overridable in tests to exercise the transaction-timeout path. */
  private txTimeoutMs = TX_TIMEOUT_MS;

  constructor(private readonly prisma: PrismaService) {}

  findStoryText(storyId: string) {
    return this.prisma.story.findFirst({
      where: { id: storyId, isDeleted: false },
      select: { id: true, textContent: true },
    });
  }

  findByStory(
    storyId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<StorySceneImage[]> {
    return this.prisma.storySceneImage.findMany({
      where: { storyId, ...(opts.includeDeleted ? {} : { isDeleted: false }) },
      orderBy: { sceneIndex: 'asc' },
    });
  }

  findApprovedByStory(storyId: string): Promise<StorySceneImage[]> {
    return this.prisma.storySceneImage.findMany({
      where: {
        storyId,
        status: 'APPROVED',
        isDeleted: false,
        imageUrl: { not: null },
      },
      orderBy: { sceneIndex: 'asc' },
    });
  }

  findByIdWithStory(id: string): Promise<SceneWithStory | null> {
    return this.prisma.storySceneImage.findFirst({
      where: { id },
      include: withStory,
    });
  }

  async applyPlan(
    storyId: string,
    build: (existing: StorySceneImage[]) => ScenePlan,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Serialise concurrent redefinitions of the same story (released at commit).
        // Fail fast instead of queueing behind a long redefinition: a waiter
        // otherwise pins a pooled connection until the tx timeout (55P03).
        await tx.$executeRawUnsafe(
          `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`,
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storyId}))`;
        const existing = await tx.storySceneImage.findMany({
          where: { storyId },
          orderBy: { sceneIndex: 'asc' },
        });
        const plan = build(existing);
        const row = tx.storySceneImage;

        // A: free slots. Retired rows go straight to their (unique, negative)
        // parking index; moving kept rows go to a temporary high index.
        for (const r of plan.retires) {
          await row.update({
            where: { id: r.id },
            data: {
              isDeleted: true,
              deletedAt: new Date(),
              ...(r.parkIndex !== null ? { sceneIndex: r.parkIndex } : {}),
            },
          });
        }
        const moving = plan.keeps.filter((k) => k.fromIndex !== k.sceneIndex);
        for (const k of moving) {
          await row.update({
            where: { id: k.id },
            data: { sceneIndex: TEMP_INDEX_OFFSET + k.fromIndex },
          });
        }
        // B: final positions. Only rows that actually change are written, so
        // untouched pending scenes keep their review-queue position.
        for (const k of plan.keeps) {
          const edited = k.prompt !== undefined || k.styleNotes !== undefined;
          if (k.fromIndex === k.sceneIndex && !edited) continue;
          await row.update({
            where: { id: k.id },
            data: {
              sceneIndex: k.sceneIndex,
              ...(k.prompt !== undefined ? { prompt: k.prompt } : {}),
              ...(k.styleNotes !== undefined
                ? { styleNotes: k.styleNotes }
                : {}),
            },
          });
        }
        for (const c of plan.creates) {
          await row.create({
            data: {
              storyId,
              sceneIndex: c.sceneIndex,
              startPage: c.startPage,
              endPage: c.endPage,
              textHash: c.textHash,
              prompt: c.prompt ?? null,
              styleNotes: c.styleNotes ?? null,
            },
          });
        }
      },
      { timeout: this.txTimeoutMs, maxWait: 10_000 },
    );
  }

  async updateIf(
    id: string,
    guard: Prisma.StorySceneImageWhereInput,
    data: Prisma.StorySceneImageUncheckedUpdateInput,
  ): Promise<StorySceneImage | null> {
    // Single guarded UPDATE ... RETURNING. `updateManyAndReturn` (unlike
    // `update`) returns an empty array when the guard does not match, so an
    // expected lost race is silent (no prisma:error P2025 log / Sentry noise).
    const rows = await this.prisma.storySceneImage.updateManyAndReturn({
      where: { AND: [{ id }, guard] },
      data,
    });
    return rows[0] ?? null;
  }

  async listForReview(params: {
    status: SceneImageStatus;
    skip: number;
    take: number;
  }) {
    const where = { status: params.status, isDeleted: false };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.storySceneImage.findMany({
        where,
        include: withStory,
        // id tiebreaker => deterministic total order for pagination
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.storySceneImage.count({ where }),
    ]);
    return { items, total };
  }
}
