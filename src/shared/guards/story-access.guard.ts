import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CHECK_STORY_QUOTA_KEY } from '../decorators/story-quota.decorator';
import { StoryQuotaService, StoryAccessResult } from '@/story/story-quota.service';

export interface RequestWithStoryAccess {
  authUserData?: { userId: string };
  storyAccessResult?: StoryAccessResult;
  params?: { id?: string; storyId?: string };
  body?: { storyId?: string };
}

@Injectable()
export class StoryAccessGuard implements CanActivate {
  constructor(
    private readonly storyQuotaService: StoryQuotaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if endpoint is marked with @CheckStoryQuota()
    const requiresQuotaCheck = this.reflector.getAllAndOverride<boolean>(
      CHECK_STORY_QUOTA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresQuotaCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithStoryAccess>();
    const userId = request.authUserData?.userId;
    const storyId =
      request.params?.id || request.params?.storyId || request.body?.storyId;

    // If no userId or storyId, let the controller handle validation
    if (!userId || !storyId) {
      return true;
    }

    const result = await this.storyQuotaService.checkStoryAccess(userId, storyId);

    if (!result.canAccess) {
      throw new ForbiddenException({
        message: 'Story limit reached. Upgrade to premium for unlimited access.',
        code: 'STORY_LIMIT_EXCEEDED',
        remaining: result.remaining,
        totalAllowed: result.totalAllowed,
      });
    }

    // Attach result to request for controller use
    request.storyAccessResult = result;
    return true;
  }
}
