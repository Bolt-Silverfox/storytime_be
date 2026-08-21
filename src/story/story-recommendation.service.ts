import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  STORY_CORE_REPOSITORY,
  IStoryCoreRepository,
} from './repositories/story-core.repository.interface';
import {
  STORY_RECOMMENDATION_REPOSITORY,
  IStoryRecommendationRepository,
} from './repositories/story-recommendation.repository.interface';
import {
  CreateStoryDto,
  ParentRecommendationDto,
  RecommendationResponseDto,
  RecommendationsStatsDto,
  RestrictStoryDto,
} from './dto/story.dto';
import type { ParentRecommendation } from '@prisma/client';

@Injectable()
export class StoryRecommendationService {
  constructor(
    @Inject(STORY_CORE_REPOSITORY)
    private readonly storyCoreRepository: IStoryCoreRepository,
    @Inject(STORY_RECOMMENDATION_REPOSITORY)
    private readonly storyRecommendationRepository: IStoryRecommendationRepository,
  ) {}

  // =====================
  // STORY RESTRICTIONS
  // =====================

  async restrictStory(dto: RestrictStoryDto & { userId: string }) {
    const kid = await this.storyCoreRepository.findKidById(dto.kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    // Ensure parent owns the kid
    if (kid.parentId !== dto.userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const story = await this.storyCoreRepository.findStoryById(dto.storyId);
    if (!story) throw new NotFoundException('Story not found');

    return await this.storyCoreRepository.restrictStory(
      dto.kidId,
      dto.storyId,
      dto.userId,
      dto.reason,
    );
  }

  async unrestrictStory(kidId: string, storyId: string, userId: string) {
    const kid = await this.storyCoreRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const restriction = await this.storyCoreRepository.findRestrictedStory(
      kidId,
      storyId,
    );

    if (!restriction) {
      throw new NotFoundException('Story is not restricted for this kid');
    }

    return await this.storyCoreRepository.unrestrictStory(kidId, storyId);
  }

  async getRestrictedStories(kidId: string, userId: string) {
    const kid = await this.storyCoreRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    const restricted =
      await this.storyCoreRepository.findRestrictedStories(kidId);

    return restricted.map((r) => ({
      ...r.story,
      restrictionReason: r.reason,
      restrictedAt: r.createdAt,
    }));
  }

  // =====================
  // PARENT RECOMMENDATIONS
  // =====================

  async recommendStoryToKid(
    userId: string,
    dto: ParentRecommendationDto,
  ): Promise<RecommendationResponseDto> {
    const kid = await this.storyCoreRepository.findKidByIdAndParent(
      dto.kidId,
      userId,
    );
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const story = await this.storyCoreRepository.findStoryById(dto.storyId);
    // Reject a known draft id: an unpublished story can't be recommended to a
    // kid. findStoryById is shared with existence checks, so gate here, not in
    // the repository.
    if (!story || !story.isPublished) {
      throw new NotFoundException('Story not found');
    }

    const isRestricted = await this.storyCoreRepository.findRestrictedStory(
      dto.kidId,
      dto.storyId,
    );

    if (isRestricted) {
      throw new BadRequestException(
        'This story is currently restricted for this kid. Please unrestrict it first.',
      );
    }

    const existing =
      await this.storyRecommendationRepository.findParentRecommendationByUnique(
        userId,
        dto.kidId,
        dto.storyId,
      );
    if (existing) {
      if (existing.isDeleted) {
        const restored =
          await this.storyRecommendationRepository.updateParentRecommendation(
            existing.id,
            { isDeleted: false, deletedAt: null, message: dto.message },
          );
        return this.toRecommendationResponse(restored);
      }
      throw new BadRequestException(
        `You have already recommended this story to ${kid.name}`,
      );
    }
    const recommendation =
      await this.storyRecommendationRepository.createParentRecommendation(
        userId,
        dto.kidId,
        dto.storyId,
        dto.message,
      );
    return this.toRecommendationResponse(recommendation);
  }

  async getKidRecommendations(
    kidId: string,
    userId: string,
  ): Promise<RecommendationResponseDto[]> {
    const kid = await this.storyCoreRepository.findKidByIdAndParent(
      kidId,
      userId,
    );
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const recommendations =
      await this.storyRecommendationRepository.findParentRecommendationsByKidId(
        kidId,
      );
    return recommendations.map((rec) => this.toRecommendationResponse(rec));
  }

  async deleteRecommendation(
    recommendationId: string,
    userId: string,
    permanent: boolean = false,
  ) {
    const recommendation =
      await this.storyRecommendationRepository.findParentRecommendationById(
        recommendationId,
      );
    if (!recommendation)
      throw new NotFoundException('Recommendation not found');
    if (recommendation.userId !== userId)
      throw new ForbiddenException('Access denied');
    if (permanent) {
      return this.storyRecommendationRepository.deleteParentRecommendation(
        recommendationId,
      );
    } else {
      return this.storyRecommendationRepository.updateParentRecommendationStatus(
        recommendationId,
        {
          isDeleted: true,
          deletedAt: new Date(),
        },
      );
    }
  }

  async getRecommendationStats(
    kidId: string,
    userId: string,
  ): Promise<RecommendationsStatsDto> {
    const kid = await this.storyCoreRepository.findKidByIdAndParent(
      kidId,
      userId,
    );
    if (!kid) throw new NotFoundException('Kid not found or access denied');
    const totalCount =
      await this.storyRecommendationRepository.countParentRecommendationsByKidId(
        kidId,
      );
    return { totalCount };
  }

  private toRecommendationResponse(
    recommendation: ParentRecommendation & {
      story?: Record<string, unknown>;
      user?: { id: string; name?: string | null; email?: string };
      kid?: { id: string; name?: string | null };
    },
  ): RecommendationResponseDto {
    return {
      id: recommendation.id,
      userId: recommendation.userId,
      kidId: recommendation.kidId,
      storyId: recommendation.storyId,
      message: recommendation.message ?? undefined,
      recommendedAt: recommendation.recommendedAt,
      story: recommendation.story as CreateStoryDto | undefined,
      user: recommendation.user,
      kid: recommendation.kid,
    };
  }
}
