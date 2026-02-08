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
  Request,
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
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StoryBuddyService } from './story-buddy.service';
import {
  CreateStoryBuddyDto,
  UpdateStoryBuddyDto,
  SelectBuddyDto,
  GetBuddyMessageDto,
} from './dto/story-buddy.dto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';
import { Public } from '@/shared/decorators/public.decorator';
import { SuccessResponse } from '@/shared/dtos/api-response.dto';

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

  // KID ENDPOINTS

  @Post('kids/:kidId/select')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Select story buddy for kid',
    description:
      'Assign a story buddy to a kid profile. Only the parent can select a buddy for their child.',
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
          success: true,
          message: 'Successfully selected Lumina as story buddy',
          buddy: {
            id: 'buddy-123-uuid',
            name: 'lumina',
            displayName: 'Lumina',
            imageUrl: 'https://example.com/lumina.png',
            type: 'robot',
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
    status: 403,
    description: 'Forbidden - Not the parent of this kid',
  })
  @ApiResponse({
    status: 404,
    description: 'Kid or story buddy not found',
  })
  async selectBuddyForKid(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Body() selectBuddyDto: SelectBuddyDto,
  ) {
    const result = await this.storyBuddyService.selectBuddyForKid(
      kidId,
      selectBuddyDto.buddyId,
      req.authUserData.userId,
    );
    return new SuccessResponse(
      200,
      result,
      'Story buddy selected successfully',
    );
  }

  @Get('kids/:kidId/buddy')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get kid's current buddy",
    description:
      "Retrieve the current story buddy assigned to a kid. Only the parent can view their child's buddy.",
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiResponse({
    status: 200,
    description: "Kid's buddy retrieved successfully",
    schema: {
      example: {
        statusCode: 200,
        message: "Kid's buddy retrieved successfully",
        data: {
          id: 'buddy-123-uuid',
          name: 'lumina',
          displayName: 'Lumina',
          imageUrl: 'https://example.com/lumina.png',
          type: 'robot',
          description: 'A friendly robot companion',
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not the parent of this kid',
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found or no buddy selected',
  })
  async getKidCurrentBuddy(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    const buddy = await this.storyBuddyService.getKidCurrentBuddy(
      kidId,
      req.authUserData.userId,
    );
    return new SuccessResponse(
      200,
      buddy,
      "Kid's buddy retrieved successfully",
    );
  }

  @Get('kids/:kidId/welcome')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get welcome message from kid's buddy",
    description:
      "Retrieve a personalized welcome message from the kid's story buddy. Only the parent can access their child's messages.",
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
            name: 'lumina',
            displayName: 'Lumina',
            imageUrl: 'https://example.com/lumina.png',
          },
          imageUrl: 'https://example.com/lumina.png',
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not the parent of this kid',
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found or no buddy selected',
  })
  async getBuddyWelcome(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    const welcome = await this.storyBuddyService.getBuddyWelcome(
      kidId,
      req.authUserData.userId,
    );
    return new SuccessResponse(
      200,
      welcome,
      'Welcome message retrieved successfully',
    );
  }

  @Post('kids/:kidId/message')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get contextual message from buddy',
    description:
      "Retrieve a contextual message from the kid's story buddy. Only the parent can access their child's messages.",
  })
  @ApiParam({
    name: 'kidId',
    description: 'Kid ID',
    example: 'kid-123-uuid',
  })
  @ApiBody({ type: GetBuddyMessageDto })
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
            name: 'lumina',
            displayName: 'Lumina',
            imageUrl: 'https://example.com/lumina.png',
          },
          message: 'Hello there! Ready for a story?',
          imageUrl: 'https://example.com/lumina.png',
          context: 'greeting',
          contextData: {},
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not the parent of this kid',
  })
  @ApiResponse({
    status: 404,
    description: 'Kid not found or no buddy selected',
  })
  async getBuddyMessage(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Body() getBuddyMessageDto: GetBuddyMessageDto,
  ) {
    const message = await this.storyBuddyService.getBuddyMessage(
      kidId,
      getBuddyMessageDto.context,
      getBuddyMessageDto.contextId,
      getBuddyMessageDto.message,
      req.authUserData.userId,
    );
    return new SuccessResponse(
      200,
      message,
      'Contextual message retrieved successfully',
    );
  }

  @Put('kids/:kidId/buddy')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Change kid's story buddy",
    description:
      "Change the story buddy assigned to a kid. Only the parent can change their child's buddy.",
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
          success: true,
          message: 'Successfully selected Zylo as story buddy',
          buddy: {
            id: 'buddy-456-uuid',
            name: 'zylo',
            displayName: 'Zylo',
            imageUrl: 'https://example.com/zylo.png',
            type: 'alien',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not the parent of this kid',
  })
  @ApiResponse({
    status: 404,
    description: 'Kid or story buddy not found',
  })
  async changeBuddy(
    @Request() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Body() selectBuddyDto: SelectBuddyDto,
  ) {
    const result = await this.storyBuddyService.selectBuddyForKid(
      kidId,
      selectBuddyDto.buddyId,
      req.authUserData.userId,
    );
    return new SuccessResponse(200, result, 'Story buddy changed successfully');
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
            name: 'lumina',
            displayName: 'Lumina',
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
      required: ['name', 'displayName', 'type', 'imageUrl'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Buddy image file (optional if imageUrl is provided)',
        },
        name: {
          type: 'string',
          description: 'Unique buddy name (lowercase)',
          example: 'lumina',
        },
        displayName: {
          type: 'string',
          description: 'Display name',
          example: 'Lumina',
        },
        type: {
          type: 'string',
          description: 'Buddy type',
          example: 'robot',
        },
        description: {
          type: 'string',
          description: 'Buddy description',
          example: 'A friendly robot companion',
        },
        imageUrl: {
          type: 'string',
          description: 'Image URL (optional if uploading file)',
          example: 'https://example.com/lumina.png',
        },
        profileAvatarUrl: {
          type: 'string',
          description: 'Profile avatar URL',
          example: 'https://example.com/lumina-avatar.png',
        },
        isActive: {
          type: 'boolean',
          description: 'Is active',
          example: true,
        },
        themeColor: {
          type: 'string',
          description: 'Theme color for UI',
          example: '#4CAF50',
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
          name: 'lumina',
          displayName: 'Lumina',
          type: 'robot',
          imageUrl: 'https://example.com/lumina.png',
          isActive: true,
          themeColor: '#4CAF50',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Either image or imageUrl required',
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
        displayName: { type: 'string', example: 'Lumina Updated' },
        type: { type: 'string', example: 'robot' },
        description: { type: 'string' },
        imageUrl: { type: 'string' },
        profileAvatarUrl: { type: 'string' },
        isActive: { type: 'boolean' },
        themeColor: { type: 'string' },
        ageGroupMin: { type: 'number' },
        ageGroupMax: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Story buddy updated successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story buddy updated successfully',
        data: {
          id: 'buddy-123-uuid',
          name: 'lumina',
          displayName: 'Lumina Updated',
          type: 'robot',
          imageUrl: 'https://example.com/lumina-updated.png',
          isActive: true,
        },
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
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description:
      'Permanently delete the story buddy (default: false - soft delete)',
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
  async deleteBuddy(
    @Param('id') id: string,
    @Query('permanent') permanent: boolean = false,
  ) {
    await this.storyBuddyService.deleteBuddy(id, permanent);
    return new SuccessResponse(200, null, 'Story buddy deleted successfully');
  }

  @Post(':id/undo-delete')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Restore soft deleted story buddy (Admin)',
    description: 'Restore a soft deleted story buddy. Admin access required.',
  })
  @ApiParam({
    name: 'id',
    description: 'Story Buddy ID',
    example: 'buddy-123-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Story buddy restored successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story buddy restored successfully',
        data: {
          id: 'buddy-123-uuid',
          name: 'lumina',
          displayName: 'Lumina',
          isActive: true,
          isDeleted: false,
          deletedAt: null,
        },
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
  @ApiResponse({
    status: 404,
    description: 'Story buddy not found',
  })
  async undoDeleteBuddy(@Param('id') id: string) {
    const buddy = await this.storyBuddyService.undoDeleteBuddy(id);
    return new SuccessResponse(200, buddy, 'Story buddy restored successfully');
  }

  @Get('admin/stats')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Get buddy statistics (Admin)',
    description:
      'Get statistics about story buddies usage. Admin access required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Buddy statistics retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Buddy statistics retrieved successfully',
        data: {
          totalBuddies: 2,
          totalInteractions: 45,
          totalKidsWithBuddies: 30,
          buddies: [
            {
              id: 'buddy-123-uuid',
              name: 'lumina',
              displayName: 'Lumina',
              isActive: true,
              kidCount: 25,
              interactionCount: 150,
            },
          ],
        },
      },
    },
  })
  async getBuddyStats() {
    const stats = await this.storyBuddyService.getBuddyStats();
    return new SuccessResponse(
      200,
      stats,
      'Buddy statistics retrieved successfully',
    );
  }
}
