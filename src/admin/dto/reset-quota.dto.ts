import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ResetQuotaDto {
  @ApiPropertyOptional({ description: 'Reset uniqueStoriesRead to 0' })
  @IsOptional()
  @IsBoolean()
  resetStoryQuota?: boolean;

  @ApiPropertyOptional({ description: 'Reset bonusStories to 0' })
  @IsOptional()
  @IsBoolean()
  resetBonusStories?: boolean;

  @ApiPropertyOptional({ description: 'Reset elevenLabsCount to 0' })
  @IsOptional()
  @IsBoolean()
  resetElevenLabsCount?: boolean;

  @ApiPropertyOptional({ description: 'Reset geminiStoryCount to 0' })
  @IsOptional()
  @IsBoolean()
  resetGeminiStory?: boolean;

  @ApiPropertyOptional({ description: 'Reset geminiImageCount to 0' })
  @IsOptional()
  @IsBoolean()
  resetGeminiImage?: boolean;

  @ApiPropertyOptional({
    description:
      'Nulls selectedSecondVoiceId and elevenLabsTrialStoryId (voice lock)',
  })
  @IsOptional()
  @IsBoolean()
  resetVoiceLock?: boolean;
}
