import { SetMetadata } from '@nestjs/common';

export const CHECK_STORY_QUOTA_KEY = 'checkStoryQuota';
export const CheckStoryQuota = () => SetMetadata(CHECK_STORY_QUOTA_KEY, true);
