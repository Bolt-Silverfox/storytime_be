// src/story-buddy/story-buddy.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { StoryBuddyService } from './story-buddy.service';
import {
  CreateStoryBuddyDto,
  UpdateStoryBuddyDto,
  SelectBuddyDto,
  GetBuddyMessageDto,
  InteractionContext,
} from './story-buddy.dto';
import { AuthSessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { Public } from '../auth/public.decorator';
import { SuccessResponse } from '../common/dtos/api-response.dto';

@Controller('story-buddies')
@UseGuards(AuthSessionGuard)
@ApiTags('Story Buddy')
export class StoryBuddyController {
  constructor(private readonly storyBuddyService: StoryBuddyService) {}

  // PUBLIC ENDPOINTS

  @Public()
  @Get('active')
  @ApiOperation({
    summary: 'Get active story buddies',
    description:
      'Retrieve all active story buddies available for selection. Optionally filter by kid age. Does not require authentication.',
  })
  @ApiQuery({
    name: 'kidAge',
    required: false,
    type: Number,
    description: 'Kid age to filter buddies by age range',
    example: 7,
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
            name: 'lucious',
            displayName: 'Lucious',
            description: 'A friendly robot companion',
            type: 'robot',
            imageUrl: 'https://example.com/lucious.png',
            personality: '{"tone": "friendly", "energy": "high"}',
            voiceType: 'child-friendly',
            greetingMessages: ['Hello friend!', 'Ready for an adventure?'],
            isActive: true,
            ageGroupMin: 3,
            ageGroupMax: 12,
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-01T12:00:00Z',
          },
        ],
      },
    },
  })
  async getActiveBuddies(@Query('kidAge', new ParseIntPipe({ optional: true })) kidAge?: number) {
    const buddies = await this.storyBuddyService.getActiveBuddies(kidAge);
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
    description: 'Retrieve a single story buddy by ID. Does not require authentication.',
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
          name: 'lucious',
          displayName: 'Lucious',
          description: 'A friendly robot companion',
          type: 'robot',
          imageUrl: 'https://example.com/lucious.png',
          personality: '{"tone": "friendly", "energy": "high"}',
          voiceType: 'child-friendly',
          greetingMessages: ['Hello friend!'],
          isActive: true,
          ageGroupMin: 3,
          ageGroupMax: 12,
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
    return new SuccessResponse(200, buddy, 'Story buddy retrieved successfully');
  }

  // KID ENDPOINTS

  @Post('kids/:kidId/select')
  @ApiOperation({
    summary: 'Select story buddy for kid',
    description: 'Assign a story buddy to a kid profile.',
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiBody({ type: SelectBuddyDto })
  @ApiResponse({
    status: 200,
    description: 'Story buddy selected successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story buddy selected successfully',
        data: {
          id: 'kid-123-uuid',
          name: 'Jane',
          ageRange: '6-8',
          storyBuddyId: 'buddy-123-uuid',
          buddySelectedAt: '2023-10-02T10:30:00Z',
          storyBuddy: {
            id: 'buddy-123-uuid',
            name: 'lucious',
            displayName: 'Lucious',
            imageUrl: 'https://example.com/lucious.png',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Buddy not available',
  })
  @ApiResponse({
    status: 404,
    description: 'Kid or story buddy not found',
  })
  async selectBuddyForKid(
    @Param('kidId') kidId: string,
    @Body() selectBuddyDto: SelectBuddyDto,
  ) {
    const kid = await this.storyBuddyService.selectBuddyForKid(
      kidId,
      selectBuddyDto.buddyId,
    );
    return new SuccessResponse(200, kid, 'Story buddy selected successfully');
  }

  @Get('kids/:kidId/buddy')
  @ApiOperation({
    summary: 'Get kid\'s current buddy',
    description: 'Retrieve the current story buddy assigned to a kid.',
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Kid\'s buddy retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Kid\'s buddy retrieved successfully',
        data: {
          id: 'buddy-123-uuid',
          name: 'lucious',
          displayName: 'Lucious',
          imageUrl: 'https://example.com/lucious.png',
          type: 'robot',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found or no buddy selected',
  })
  async getKidCurrentBuddy(@Param('kidId') kidId: string) {
    const buddy = await this.storyBuddyService.getKidCurrentBuddy(kidId);
    return new SuccessResponse(200, buddy, 'Kid\'s buddy retrieved successfully');
  }

  @Get('kids/:kidId/welcome')
  @ApiOperation({
    summary: 'Get welcome message from kid\'s buddy',
    description: 'Retrieve a personalized welcome message from the kid\'s story buddy.',
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Welcome message retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Welcome message retrieved successfully',
        data: {
          buddy: {
            id: 'buddy-123-uuid',
            name: 'lucious',
            displayName: 'Lucious',
            imageUrl: 'https://example.com/lucious.png',
          },
          message: 'Hello Jane! I am Lucious. Ready to start reading together?',
          imageUrl: 'https://example.com/lucious.png',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found or no buddy selected',
  })
  async getBuddyWelcome(@Param('kidId') kidId: string) {
    const welcome = await this.storyBuddyService.getBuddyWelcome(kidId);
    return new SuccessResponse(
      200,
      welcome,
      'Welcome message retrieved successfully',
    );
  }

  @Get('kids/:kidId/message/:context')
  @ApiOperation({
    summary: 'Get contextual message from buddy',
    description:
      'Retrieve a contextual message from the kid\'s story buddy (bedtime, challenge, story_start, etc.).',
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiParam({
    name: 'context',
    description: 'Interaction context',
    enum: InteractionContext,
    example: 'bedtime',
  })
  @ApiQuery({
    name: 'contextId',
    required: false,
    type: String,
    description: 'Optional context ID (e.g., story ID)',
    example: 'story-456-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Contextual message retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Contextual message retrieved successfully',
        data: {
          buddy: {
            id: 'buddy-123-uuid',
            name: 'lucious',
            displayName: 'Lucious',
            imageUrl: 'https://example.com/lucious.png',
          },
          message: 'Hey Jane, it\'s bedtime! Let me help you wind down with a wonderful story.',
          imageUrl: 'https://example.com/lucious.png',
          context: 'bedtime',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found or no buddy selected',
  })
  async getBuddyMessage(
    @Param('kidId') kidId: string,
    @Param('context') context: InteractionContext,
    @Query('contextId') contextId?: string,
  ) {
    const message = await this.storyBuddyService.getBuddyMessage(
      kidId,
      context,
      contextId,
    );
    return new SuccessResponse(
      200,
      message,
      'Contextual message retrieved successfully',
    );
  }

  @Get('kids/:kidId/interactions')
  @ApiOperation({
    summary: 'Get buddy interaction history',
    description: 'Retrieve interaction history between a kid and their story buddy.',
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of interactions to retrieve',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Interaction history retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Interaction history retrieved successfully',
        data: [
          {
            id: 'interaction-123-uuid',
            kidId: 'kid-123-uuid',
            buddyId: 'buddy-123-uuid',
            interactionType: 'greeting',
            context: null,
            message: 'Hello Jane!',
            timestamp: '2023-10-02T10:30:00Z',
            buddy: {
              id: 'buddy-123-uuid',
              displayName: 'Lucious',
            },
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found',
  })
  async getBuddyInteractionHistory(
    @Param('kidId') kidId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const interactions = await this.storyBuddyService.getBuddyInteractionHistory(
      kidId,
      limit,
    );
    return new SuccessResponse(
      200,
      interactions,
      'Interaction history retrieved successfully',
    );
  }

  @Put('kids/:kidId/buddy')
  @ApiOperation({
    summary: 'Change kid\'s story buddy',
    description: 'Change the story buddy assigned to a kid.',
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiBody({ type: SelectBuddyDto })
  @ApiResponse({
    status: 200,
    description: 'Story buddy changed successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story buddy changed successfully',
        data: {
          id: 'kid-123-uuid',
          name: 'Jane',
          storyBuddyId: 'buddy-456-uuid',
          buddySelectedAt: '2023-10-03T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Kid or story buddy not found',
  })
  async changeBuddy(
    @Param('kidId') kidId: string,
    @Body() selectBuddyDto: SelectBuddyDto,
  ) {
    const kid = await this.storyBuddyService.changeBuddy(
      kidId,
      selectBuddyDto.buddyId,
    );
    return new SuccessResponse(200, kid, 'Story buddy changed successfully');
  }

  // ADMIN ENDPOINTS

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Get all story buddies (Admin)',
    description:
      'Retrieve all story buddies including inactive ones. Admin access required.',
  })
  @ApiResponse({
    status: 200,
    description: 'All story buddies retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'All story buddies retrieved successfully',
        data: [
          {
            id: 'buddy-123-uuid',
            name: 'lucious',
            displayName: 'Lucious',
            isActive: true,
            _count: {
              kids: 15,
              buddyInteractions: 342,
            },
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  async getAllBuddies() {
    const buddies = await this.storyBuddyService.getAllBuddies();
    return new SuccessResponse(
      200,
      buddies,
      'All story buddies retrieved successfully',
    );
  }

  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Create story buddy (Admin)',
    description:
      'Create a new story buddy. Admin access required. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'displayName', 'type'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Buddy image file (optional if URL is provided)',
        },
        name: {
          type: 'string',
          description: 'Unique buddy name (lowercase)',
          example: 'lucious',
        },
        displayName: {
          type: 'string',
          description: 'Display name',
          example: 'Lucious',
        },
        description: {
          type: 'string',
          description: 'Buddy description',
          example: 'A friendly robot companion',
        },
        type: {
          type: 'string',
          description: 'Buddy type',
          example: 'robot',
        },
        url: {
          type: 'string',
          description: 'Image URL (optional if uploading file)',
          example: 'https://example.com/lucious.png',
        },
        personality: {
          type: 'string',
          description: 'Personality JSON string',
          example: '{"tone": "friendly"}',
        },
        voiceType: {
          type: 'string',
          description: 'Voice type',
          example: 'child-friendly',
        },
        greetingMessages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of greeting messages',
          example: ['Hello!', 'Ready to read?'],
        },
        ageGroupMin: {
          type: 'number',
          description: 'Minimum age',
          example: 3,
        },
        ageGroupMax: {
          type: 'number',
          description: 'Maximum age',
          example: 12,
        },
        isActive: {
          type: 'boolean',
          description: 'Is active',
          example: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Story buddy created successfully',
    schema: {
      example: {
        statusCode: 201,
        message: 'Story buddy created successfully',
        data: {
          id: 'buddy-new-uuid',
          name: 'lucious',
          displayName: 'Lucious',
          imageUrl: 'https://example.com/lucious.png',
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Either image or URL required',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict - Buddy with same name already exists',
  })
  async createBuddy(
    @Body() createDto: CreateStoryBuddyDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|gif|webp)' }),
        ],
        fileIsRequired: false,
      }),
    )
    file?: Express.Multer.File,
  ) {
    const buddy = await this.storyBuddyService.createBuddy(createDto, file);
    return new SuccessResponse(201, buddy, 'Story buddy created successfully');
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Update story buddy (Admin)',
    description:
      'Update an existing story buddy. Admin access required. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({
    name: 'id',
    description: 'Story Buddy ID',
    example: 'buddy-123-uuid',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'New buddy image file (optional)',
        },
        displayName: { type: 'string', example: 'Lucious Updated' },
        description: { type: 'string' },
        type: { type: 'string' },
        url: { type: 'string' },
        personality: { type: 'string' },
        voiceType: { type: 'string' },
        greetingMessages: { type: 'array', items: { type: 'string' } },
        ageGroupMin: { type: 'number' },
        ageGroupMax: { type: 'number' },
        isActive: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Story buddy updated successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({
    status: 404,
    description: 'Story buddy not found',
  })
  async updateBuddy(
    @Param('id') id: string,
    @Body() updateDto: UpdateStoryBuddyDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|gif|webp)' }),
        ],
        fileIsRequired: false,
      }),
    )
    file?: Express.Multer.File,
  ) {
    const buddy = await this.storyBuddyService.updateBuddy(id, updateDto, file);
    return new SuccessResponse(200, buddy, 'Story buddy updated successfully');
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Delete story buddy (Admin)',
    description:
      'Delete a story buddy. Cannot delete if assigned to any kids. Admin access required.',
  })
  @ApiParam({
    name: 'id',
    description: 'Story Buddy ID',
    example: 'buddy-123-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Story buddy deleted successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story buddy deleted successfully',
        data: null,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Cannot delete buddy currently in use',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @ApiResponse({
    status: 404,
    description: 'Story buddy not found',
  })
  async deleteBuddy(@Param('id') id: string) {
    await this.storyBuddyService.deleteBuddy(id);
    return new SuccessResponse(200, null, 'Story buddy deleted successfully');
  }
}