import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StoryBuddyService } from './story-buddy.service';
import { SelectBuddyDto, GetBuddyMessageDto } from './dto/story-buddy.dto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { SuccessResponse } from '@/shared/dtos/api-response.dto';

@Controller('story-buddies')
@UseGuards(AuthSessionGuard)
@ApiTags('Story Buddy')
export class StoryBuddyKidController {
  constructor(private readonly storyBuddyService: StoryBuddyService) {}

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
}
