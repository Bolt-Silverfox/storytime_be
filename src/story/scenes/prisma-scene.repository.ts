import { Injectable } from '@nestjs/common';
import type { Prisma, SceneImageStatus, StorySceneImage } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IStorySceneRepository,
  ScenePlanItem,
  SceneWithStory,
} from './scene.repository.interface';

const withStory = {
  story: { select: { id: true, title: true, textContent: true } },
} as const;

const RESET_STATE = {
  status: 'PENDING_GENERATION' as const,
  imageUrl: null,
  provider: null,
  model: null,
  reviewedById: null,
  reviewedAt: null,
  rejectionReason: null,
};

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

  async applyPlan(
    storyId: string,
    plan: { upserts: ScenePlanItem[]; removeIndexes: number[] },
  ): Promise<void> {
    await this.prisma.$transaction([
      ...plan.upserts.map((u) => {
        const base = {
          startPage: u.startPage,
          endPage: u.endPage,
          textHash: u.textHash,
          ...(u.prompt !== undefined ? { prompt: u.prompt } : {}),
          ...(u.styleNotes !== undefined ? { styleNotes: u.styleNotes } : {}),
          isDeleted: false,
          deletedAt: null,
        };
        return this.prisma.storySceneImage.upsert({
          where: {
            storyId_sceneIndex: { storyId, sceneIndex: u.sceneIndex },
          },
          create: {
            storyId,
            sceneIndex: u.sceneIndex,
            ...base,
            prompt: u.prompt ?? null,
            styleNotes: u.styleNotes ?? null,
          },
          update: u.reset ? { ...base, ...RESET_STATE } : base,
        });
      }),
      ...(plan.removeIndexes.length
        ? [
            this.prisma.storySceneImage.updateMany({
              where: { storyId, sceneIndex: { in: plan.removeIndexes } },
              data: { isDeleted: true, deletedAt: new Date() },
            }),
          ]
        : []),
    ]);
  }

  update(
    id: string,
    data: Prisma.StorySceneImageUncheckedUpdateInput,
  ): Promise<StorySceneImage> {
    return this.prisma.storySceneImage.update({ where: { id }, data });
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
