import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from './decorators/admin.decorator';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import {
  ReadingAnalyticsRangeDto,
  TopStoriesQueryDto,
} from './dto/reading-analytics.dto';

@ApiBearerAuth()
@Controller('admin/reading-analytics')
@Admin()
@ApiTags('admin')
export class AdminReadingAnalyticsController {
  constructor(private readonly service: AdminReadingAnalyticsService) {}

  @Get('top-stories')
  @ApiOperation({
    summary:
      'Top stories by distinct readers, 5-reader minimum to show a count',
  })
  async getTopStories(@Query() query: TopStoriesQueryDto) {
    const { data, meta } = await this.service.getTopStoriesPage(query);
    return {
      statusCode: 200,
      message: 'Top stories retrieved successfully',
      data,
      meta,
    };
  }

  @Get('stories/:storyId')
  @ApiOperation({ summary: 'Reading stats and reader list for one story' })
  async getStoryDetail(
    @Param('storyId') storyId: string,
    @Query() range: ReadingAnalyticsRangeDto,
  ) {
    const data = await this.service.getStoryDetail(storyId, range);
    return {
      statusCode: 200,
      message: 'Story reading detail retrieved successfully',
      data,
    };
  }

  @Get('stories/:storyId/trend')
  @ApiOperation({ summary: 'Reading trend series for one story' })
  async getStoryTrend(
    @Param('storyId') storyId: string,
    @Query() range: ReadingAnalyticsRangeDto,
  ) {
    const data = await this.service.getStoryTrend(storyId, range);
    return {
      statusCode: 200,
      message: 'Story reading trend retrieved successfully',
      data,
    };
  }
}
