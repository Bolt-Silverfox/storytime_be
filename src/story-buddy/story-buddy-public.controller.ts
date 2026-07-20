import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { StoryBuddyService } from './story-buddy.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { Public } from '@/shared/decorators/public.decorator';
import { SuccessResponse } from '@/shared/dtos/api-response.dto';

@Controller('story-buddies')
@UseGuards(AuthSessionGuard)
@ApiTags('Story Buddy')
export class StoryBuddyPublicController {
  constructor(private readonly storyBuddyService: StoryBuddyService) {}

  // PUBLIC ENDPOINTS

  @Public()
  @Get('active')
  @ApiOperation({
    summary: 'Get active story buddies',
    description:
      'Retrieve all active story buddies available for selection. Does not require authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Active story buddies retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Active story buddies retrieved successfully',
        data: [
          {
            id: 'buddy-123-uuid',
            name: 'lumina',
            displayName: 'Lumina',
            description: 'A friendly robot companion',
            type: 'robot',
            imageUrl: 'https://example.com/lumina.png',
            isActive: true,
            themeColor: '#4CAF50',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-01T12:00:00Z',
          },
        ],
      },
    },
  })
  async getActiveBuddies() {
    const buddies = await this.storyBuddyService.getActiveBuddies();
    return new SuccessResponse(
      200,
      buddies,
      'Active story buddies retrieved successfully',
    );
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get story buddy by ID',
    description:
      'Retrieve a single story buddy by ID. Does not require authentication.',
  })
  @ApiParam({
    name: 'id',
    description: 'Story Buddy ID',
    example: 'buddy-123-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Story buddy retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story buddy retrieved successfully',
        data: {
          id: 'buddy-123-uuid',
          name: 'lumina',
          displayName: 'Lumina',
          description: 'A friendly robot companion',
          type: 'robot',
          imageUrl: 'https://example.com/lumina.png',
          isActive: true,
          themeColor: '#4CAF50',
          createdAt: '2023-10-01T12:00:00Z',
          updatedAt: '2023-10-01T12:00:00Z',
          _count: {
            kids: 15,
            buddyInteractions: 342,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Story buddy not found',
  })
  async getBuddyById(@Param('id') id: string) {
    const buddy = await this.storyBuddyService.getBuddyById(id);
    return new SuccessResponse(
      200,
      buddy,
      'Story buddy retrieved successfully',
    );
  }
}
