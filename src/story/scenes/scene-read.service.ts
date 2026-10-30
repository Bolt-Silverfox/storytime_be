import { Inject, Injectable } from '@nestjs/common';
import {
  IStorySceneRepository,
  STORY_SCENE_REPOSITORY,
} from './scene.repository.interface';
import { hashSceneText, splitStoryIntoPages } from './story-pages.util';

export interface PublicScene {
  index: number;
  startPage: number;
  endPage: number;
  imageUrl: string;
}

export interface StoryReadExtras {
  /** Backend page split (30-word, sentence-preserving), 0-based. */
  pages: string[];
  /** APPROVED, non-stale scenes with an image only. */
  scenes: PublicScene[];
}

@Injectable()
export class SceneReadService {
  constructor(
    @Inject(STORY_SCENE_REPOSITORY)
    private readonly repo: IStorySceneRepository,
  ) {}

  async getReadExtras(
    storyId: string,
    textContent: string | null | undefined,
  ): Promise<StoryReadExtras> {
    const pages = splitStoryIntoPages(textContent);
    if (!pages.length) return { pages, scenes: [] };

    const rows = await this.repo.findApprovedByStory(storyId);
    const scenes = rows
      .filter(
        (r): r is typeof r & { imageUrl: string } =>
          !!r.imageUrl &&
          r.endPage < pages.length &&
          hashSceneText(pages, r.startPage, r.endPage) === r.textHash,
      )
      .sort((a, b) => a.sceneIndex - b.sceneIndex)
      .map((r) => ({
        index: r.sceneIndex,
        startPage: r.startPage,
        endPage: r.endPage,
        imageUrl: r.imageUrl,
      }));
    return { pages, scenes };
  }
}
