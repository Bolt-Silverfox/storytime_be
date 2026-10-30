import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SceneImageStatus, StorySceneImage } from '@prisma/client';
import { UploadService } from '@/upload/upload.service';
import {
  IStorySceneRepository,
  ScenePlanItem,
  SceneWithStory,
  STORY_SCENE_REPOSITORY,
} from './scene.repository.interface';
import {
  hashSceneText,
  SceneRange,
  splitStoryIntoPages,
  validateSceneRanges,
} from './story-pages.util';

export interface SceneDefinitionInput extends SceneRange {
  prompt?: string;
  styleNotes?: string;
}

export interface AdminSceneView {
  id: string;
  storyId: string;
  sceneIndex: number;
  startPage: number;
  endPage: number;
  imageUrl: string | null;
  prompt: string | null;
  styleNotes: string | null;
  provider: string | null;
  model: string | null;
  status: SceneImageStatus;
  reviewedById: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  /** Scene text changed since it was defined; never served, cannot be approved. */
  isStale: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSceneQueueItem extends AdminSceneView {
  storyTitle: string;
}

export interface SceneUploadMeta {
  provider?: string;
  model?: string;
  prompt?: string;
}

const REVIEWABLE: SceneImageStatus[] = ['PENDING_REVIEW', 'APPROVED'];

@Injectable()
export class SceneAdminService {
  constructor(
    @Inject(STORY_SCENE_REPOSITORY)
    private readonly repo: IStorySceneRepository,
    private readonly uploadService: UploadService,
  ) {}

  private isStale(row: StorySceneImage, pages: string[]): boolean {
    return (
      row.endPage >= pages.length ||
      hashSceneText(pages, row.startPage, row.endPage) !== row.textHash
    );
  }

  private toView(row: StorySceneImage, pages: string[]): AdminSceneView {
    return {
      id: row.id,
      storyId: row.storyId,
      sceneIndex: row.sceneIndex,
      startPage: row.startPage,
      endPage: row.endPage,
      imageUrl: row.imageUrl,
      prompt: row.prompt,
      styleNotes: row.styleNotes,
      provider: row.provider,
      model: row.model,
      status: row.status,
      reviewedById: row.reviewedById,
      reviewedAt: row.reviewedAt,
      rejectionReason: row.rejectionReason,
      isStale: this.isStale(row, pages),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async load(id: string): Promise<SceneWithStory> {
    const row = await this.repo.findByIdWithStory(id);
    if (!row) throw new NotFoundException('Scene not found');
    return row;
  }

  private viewOf(row: StorySceneImage, story: SceneWithStory['story']) {
    return this.toView(row, splitStoryIntoPages(story.textContent));
  }

  async listForStory(storyId: string) {
    const story = await this.repo.findStoryText(storyId);
    if (!story) throw new NotFoundException('Story not found');
    const pages = splitStoryIntoPages(story.textContent);
    const rows = await this.repo.findByStory(storyId);
    return {
      storyId,
      pageCount: pages.length,
      scenes: rows.map((r) => this.toView(r, pages)),
    };
  }

  async replaceDefinitions(storyId: string, defs: SceneDefinitionInput[]) {
    const story = await this.repo.findStoryText(storyId);
    if (!story) throw new NotFoundException('Story not found');
    const pages = splitStoryIntoPages(story.textContent);
    const error = validateSceneRanges(defs, pages.length);
    if (error) throw new BadRequestException(error);

    const existing = await this.repo.findByStory(storyId, {
      includeDeleted: true,
    });
    const byIndex = new Map(existing.map((e) => [e.sceneIndex, e]));

    const upserts: ScenePlanItem[] = defs.map((d, sceneIndex) => {
      const textHash = hashSceneText(pages, d.startPage, d.endPage);
      const prev = byIndex.get(sceneIndex);
      const unchanged =
        !!prev &&
        !prev.isDeleted &&
        prev.startPage === d.startPage &&
        prev.endPage === d.endPage &&
        prev.textHash === textHash;
      return {
        sceneIndex,
        startPage: d.startPage,
        endPage: d.endPage,
        textHash,
        prompt: d.prompt,
        styleNotes: d.styleNotes,
        reset: !unchanged,
      };
    });
    const removeIndexes = existing
      .filter((e) => !e.isDeleted && e.sceneIndex >= defs.length)
      .map((e) => e.sceneIndex);

    await this.repo.applyPlan(storyId, { upserts, removeIndexes });
    return this.listForStory(storyId);
  }

  async uploadImage(
    id: string,
    file: Express.Multer.File,
    meta: SceneUploadMeta,
  ): Promise<AdminSceneView> {
    const row = await this.load(id);
    const pages = splitStoryIntoPages(row.story.textContent);
    if (this.isStale(row, pages)) {
      throw new ConflictException(
        'Scene is stale (story text changed); redefine the scenes first',
      );
    }
    const uploaded = await this.uploadService.uploadImageFromBuffer(
      file.buffer,
      `scene-illustrations/${row.storyId}`,
    );
    const updated = await this.repo.update(id, {
      imageUrl: uploaded.secure_url,
      status: 'PENDING_REVIEW',
      reviewedById: null,
      reviewedAt: null,
      rejectionReason: null,
      ...(meta.provider !== undefined ? { provider: meta.provider } : {}),
      ...(meta.model !== undefined ? { model: meta.model } : {}),
      ...(meta.prompt !== undefined ? { prompt: meta.prompt } : {}),
    });
    return this.viewOf(updated, row.story);
  }

  async approve(id: string, adminId: string): Promise<AdminSceneView> {
    const row = await this.load(id);
    if (!row.imageUrl) {
      throw new BadRequestException('Cannot approve a scene without an image');
    }
    if (row.status !== 'PENDING_REVIEW') {
      throw new ConflictException(
        `Only scenes pending review can be approved (status: ${row.status})`,
      );
    }
    if (this.isStale(row, splitStoryIntoPages(row.story.textContent))) {
      throw new ConflictException('Scene is stale (story text changed)');
    }
    const updated = await this.repo.update(id, {
      status: 'APPROVED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason: null,
    });
    return this.viewOf(updated, row.story);
  }

  async reject(
    id: string,
    adminId: string,
    reason: string,
  ): Promise<AdminSceneView> {
    const row = await this.load(id);
    if (!REVIEWABLE.includes(row.status)) {
      throw new ConflictException(
        `Only scenes pending review or approved can be rejected (status: ${row.status})`,
      );
    }
    const updated = await this.repo.update(id, {
      status: 'REJECTED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    });
    return this.viewOf(updated, row.story);
  }

  /** Back to PENDING_GENERATION: drops the image so it can never be approved by mistake. */
  async requestRegenerate(id: string): Promise<AdminSceneView> {
    const row = await this.load(id);
    if (row.status === 'PENDING_GENERATION') {
      throw new ConflictException('Scene is already waiting for generation');
    }
    const updated = await this.repo.update(id, {
      status: 'PENDING_GENERATION',
      imageUrl: null,
      reviewedById: null,
      reviewedAt: null,
      rejectionReason: null,
    });
    return this.viewOf(updated, row.story);
  }

  async reviewQueue(params: {
    status?: SceneImageStatus;
    page: number;
    limit: number;
  }) {
    const status = params.status ?? 'PENDING_REVIEW';
    const { items, total } = await this.repo.listForReview({
      status,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
    const data: AdminSceneQueueItem[] = items.map((r) => ({
      ...this.viewOf(r, r.story),
      storyTitle: r.story.title,
    }));
    return {
      data,
      meta: {
        total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }
}
