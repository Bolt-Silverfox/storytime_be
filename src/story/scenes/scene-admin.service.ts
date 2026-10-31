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
  ScenePlan,
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
    // Match live scenes by content (range + text hash), NOT by index, so
    // inserting/splitting an earlier scene never resets later approved art.
    const key = (s: number, e: number, h: string) => `${s}:${e}:${h}`;
    const liveByKey = new Map(
      existing
        .filter((e) => !e.isDeleted)
        .map((e) => [key(e.startPage, e.endPage, e.textHash), e]),
    );

    const keeps: ScenePlan['keeps'] = [];
    const creates: ScenePlan['creates'] = [];
    const keptIds = new Set<string>();
    defs.forEach((d, sceneIndex) => {
      const textHash = hashSceneText(pages, d.startPage, d.endPage);
      const prev = liveByKey.get(key(d.startPage, d.endPage, textHash));
      if (prev && !keptIds.has(prev.id)) {
        keptIds.add(prev.id);
        keeps.push({
          id: prev.id,
          fromIndex: prev.sceneIndex,
          sceneIndex,
          prompt: d.prompt,
          styleNotes: d.styleNotes,
        });
      } else {
        creates.push({
          sceneIndex,
          startPage: d.startPage,
          endPage: d.endPage,
          textHash,
          prompt: d.prompt,
          styleNotes: d.styleNotes,
        });
      }
    });

    // Everything not kept is retired. Rows sitting on an index a scene needs
    // are parked at a fresh negative index; the rest are soft-deleted in place.
    let nextPark = Math.min(0, ...existing.map((e) => e.sceneIndex)) - 1;
    const retires: ScenePlan['retires'] = [];
    for (const e of existing) {
      if (keptIds.has(e.id)) continue;
      const needsSlot = e.sceneIndex >= 0 && e.sceneIndex < defs.length;
      if (e.isDeleted && !needsSlot) continue;
      retires.push({ id: e.id, parkIndex: needsSlot ? nextPark-- : null });
    }

    await this.repo.applyPlan(storyId, { keeps, creates, retires });
    return this.listForStory(storyId);
  }

  async uploadImage(
    id: string,
    file: Express.Multer.File,
    meta: SceneUploadMeta,
  ): Promise<{ scene: AdminSceneView; previousImageUrl: string | null }> {
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
    // Compare-and-set on the range/text the image was made for: a PUT that
    // redefined this scene while we were uploading must not receive it.
    const updated = await this.repo.updateIf(
      id,
      {
        isDeleted: false,
        startPage: row.startPage,
        endPage: row.endPage,
        textHash: row.textHash,
      },
      {
        imageUrl: uploaded.secure_url,
        status: 'PENDING_REVIEW',
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
        ...(meta.provider !== undefined ? { provider: meta.provider } : {}),
        ...(meta.model !== undefined ? { model: meta.model } : {}),
        ...(meta.prompt !== undefined ? { prompt: meta.prompt } : {}),
      },
    );
    if (!updated) {
      await this.uploadService.deleteImage(uploaded.public_id).catch(() => {
        // best effort: an orphaned asset is preferable to failing the request
      });
      throw new ConflictException(
        'Scene was redefined while the image was uploading; upload again',
      );
    }
    return {
      scene: this.viewOf(updated, row.story),
      previousImageUrl: row.imageUrl,
    };
  }

  /**
   * Approve exactly the image the reviewer saw. Both the pre-check and the
   * write are conditional (status PENDING_REVIEW + that imageUrl + unchanged
   * range/text), so a concurrent upload/reject/regenerate can never be
   * overwritten into APPROVED.
   */
  async approve(
    id: string,
    adminId: string,
    seenImageUrl: string,
  ): Promise<AdminSceneView> {
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
    if (row.imageUrl !== seenImageUrl) {
      throw new ConflictException(
        'The scene image changed since you viewed it; review the new image',
      );
    }
    const updated = await this.repo.updateIf(
      id,
      {
        isDeleted: false,
        status: 'PENDING_REVIEW',
        imageUrl: seenImageUrl,
        startPage: row.startPage,
        endPage: row.endPage,
        textHash: row.textHash,
      },
      {
        status: 'APPROVED',
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
    );
    if (!updated) throw this.lostRace();
    return this.viewOf(updated, row.story);
  }

  async reject(
    id: string,
    adminId: string,
    reason: string,
    seenImageUrl: string,
  ): Promise<AdminSceneView> {
    const row = await this.load(id);
    if (!REVIEWABLE.includes(row.status)) {
      throw new ConflictException(
        `Only scenes pending review or approved can be rejected (status: ${row.status})`,
      );
    }
    if (row.imageUrl !== seenImageUrl) {
      throw new ConflictException(
        'The scene image changed since you viewed it; review the new image',
      );
    }
    const updated = await this.repo.updateIf(
      id,
      { isDeleted: false, status: row.status, imageUrl: seenImageUrl },
      {
        status: 'REJECTED',
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    );
    if (!updated) throw this.lostRace();
    return this.viewOf(updated, row.story);
  }

  /** Back to PENDING_GENERATION: drops the image so it can never be approved by mistake. */
  async requestRegenerate(
    id: string,
  ): Promise<{ scene: AdminSceneView; previousImageUrl: string | null }> {
    const row = await this.load(id);
    if (row.status === 'PENDING_GENERATION') {
      throw new ConflictException('Scene is already waiting for generation');
    }
    const updated = await this.repo.updateIf(
      id,
      { isDeleted: false, status: row.status, imageUrl: row.imageUrl },
      {
        status: 'PENDING_GENERATION',
        imageUrl: null,
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    );
    if (!updated) throw this.lostRace();
    return {
      scene: this.viewOf(updated, row.story),
      previousImageUrl: row.imageUrl,
    };
  }

  private lostRace() {
    return new ConflictException(
      'The scene was changed by someone else; reload and try again',
    );
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
