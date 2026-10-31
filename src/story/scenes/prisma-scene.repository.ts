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

/** Temporary index for kept rows while they swap places (unique key safety). */
const TEMP_INDEX_OFFSET = 1_000_000;

@Injectable()
export class PrismaStorySceneRepository implements IStorySceneRepository {
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
      where: { id, isDeleted: false },
      include: withStory,
    });
  }

  async applyPlan(storyId: string, plan: ScenePlan): Promise<void> {
    const row = this.prisma.storySceneImage;
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    // A: free slots. Retired rows go straight to their (unique, negative)
    // parking index; moving kept rows go to a temporary high index.
    for (const r of plan.retires) {
      ops.push(
        row.update({
          where: { id: r.id },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            ...(r.parkIndex !== null ? { sceneIndex: r.parkIndex } : {}),
          },
        }),
      );
    }
    for (const k of plan.keeps.filter((x) => x.fromIndex !== x.sceneIndex)) {
      ops.push(
        row.update({
          where: { id: k.id },
          data: { sceneIndex: TEMP_INDEX_OFFSET + k.fromIndex },
        }),
      );
    }
    // B: final positions + new rows
    for (const k of plan.keeps) {
      ops.push(
        row.update({
          where: { id: k.id },
          data: {
            sceneIndex: k.sceneIndex,
            ...(k.prompt !== undefined ? { prompt: k.prompt } : {}),
            ...(k.styleNotes !== undefined ? { styleNotes: k.styleNotes } : {}),
          },
        }),
      );
    }
    for (const c of plan.creates) {
      ops.push(
        row.create({
          data: {
            storyId,
            sceneIndex: c.sceneIndex,
            startPage: c.startPage,
            endPage: c.endPage,
            textHash: c.textHash,
            prompt: c.prompt ?? null,
            styleNotes: c.styleNotes ?? null,
          },
        }),
      );
    }
    await this.prisma.$transaction(ops);
  }

  async updateIf(
    id: string,
    guard: Prisma.StorySceneImageWhereInput,
    data: Prisma.StorySceneImageUncheckedUpdateInput,
  ): Promise<StorySceneImage | null> {
    const { count } = await this.prisma.storySceneImage.updateMany({
      where: { AND: [{ id }, guard] },
      data,
    });
    if (count === 0) return null;
    return this.prisma.storySceneImage.findUnique({ where: { id } });
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
        orderBy: { updatedAt: 'asc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.storySceneImage.count({ where }),
    ]);
    return { items, total };
  }
}
