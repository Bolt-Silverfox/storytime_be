import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kid } from '@prisma/client';
import {
  STORY_REPOSITORY,
  IStoryRepository,
  StoryWithCreatorParent,
} from '../repositories/story.repository.interface';

/**
 * Shared ownership checks for story sub-controllers.
 *
 * Extracts the previously-duplicated inline `prisma.kid.findFirst` /
 * `prisma.story.findFirst` ownership guards into a single injectable so every
 * sub-controller enforces identical query + error semantics. All DB access is
 * delegated to the existing story repository — this service holds no Prisma
 * client of its own.
 */
@Injectable()
export class KidOwnershipService {
  constructor(
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
  ) {}

  /**
   * Verifies the kid exists and belongs to the given user.
   * Throws NotFoundException with the original message otherwise.
   */
  async getOwnedKidOrThrow(kidId: string, userId: string): Promise<Kid> {
    const kid = await this.storyRepository.findKidByIdAndParent(kidId, userId);
    if (!kid) {
      throw new NotFoundException(
        `Kid ${kidId} not found or does not belong to this user`,
      );
    }
    return kid;
  }

  /**
   * Verifies the story exists and is owned (via its creator kid) by the given
   * user. Throws NotFoundException when missing, ForbiddenException when it
   * belongs to another user — preserving the original two-stage semantics.
   */
  async getOwnedStoryOrThrow(
    storyId: string,
    userId: string,
    includeDeleted = false,
  ): Promise<StoryWithCreatorParent> {
    const story = await this.storyRepository.findStoryByIdWithCreatorParent(
      storyId,
      includeDeleted,
    );
    if (!story) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }
    if (!story.creatorKidId || story.creatorKid?.parentId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to modify this story',
      );
    }
    return story;
  }
}
