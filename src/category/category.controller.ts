import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { CategoryService } from './category.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryResponseDto,
} from './category.dto';
import { AuthSessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * Get categories filtered by active kid profile age
   */
  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get categories suitable for active kid profile age',
    description:
      'Returns categories filtered by the age of the active kid profile. Authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of categories filtered by age',
    type: [CategoryResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - No active kid profile or invalid age',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async findAllByAge(@Req() req: any): Promise<CategoryResponseDto[]> {
    const activeKidProfile = req.user?.activeKidProfile;

    if (!activeKidProfile) {
      throw new BadRequestException(
        'No active kid profile found. Please select a kid profile.',
      );
    }

    const age = this.parseAgeFromRange(activeKidProfile.ageRange);
    if (!age) {
      throw new BadRequestException('Invalid age range in kid profile');
    }

    return this.categoryService.findAllByAge(age);
  }

  /**
   * Get all categories (Admin only)
   */
  @Get('all')
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all categories (Admin access only)',
    description:
      'Returns all categories without age filtering. Admin access is required.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of all categories',
    type: [CategoryResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  async findAll(): Promise<CategoryResponseDto[]> {
    return this.categoryService.findAll();
  }

  /**
   * Get a single category by ID
   */
  @Get(':id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a single category by ID',
    description: 'Returns details of a specific category',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the category',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Category details',
    type: CategoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    return this.categoryService.findOne(id);
  }

  /**
   * Create a new category
   */
  @Post()
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new category (Admin only)',
    description: 'Creates a new category along with age group associations',
  })
  @ApiBody({
    description: 'Category creation payload',
    type: CreateCategoryDto,
    examples: {
      example1: {
        summary: 'Sample category creation',
        value: {
          name: 'Adventure',
          slug: 'adventure',
          description: 'Exciting adventure stories for kids',
          image: 'https://via.placeholder.com/400x300',
          ageGroupIds: ['uuid-of-agegroup-1', 'uuid-of-agegroup-2'],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Category created successfully',
    type: CategoryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid data or duplicate slug',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.create(createCategoryDto);
  }

  /**
   * Update a category
   */
  @Patch(':id')
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a category (Admin only)',
    description: 'Updates an existing category',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the category to update',
    type: String,
  })
  @ApiBody({
    description: 'Category update payload',
    type: UpdateCategoryDto,
    examples: {
      example1: {
        summary: 'Sample update',
        value: {
          name: 'Updated Adventure',
          description: 'Updated description',
          image: 'https://via.placeholder.com/400x300',
          ageGroupIds: ['uuid-of-agegroup-1'],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Category updated successfully',
    type: CategoryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid data',
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  async update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.update(id, updateCategoryDto);
  }

  /**
   * Delete a category
   */
  @Delete(':id')
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category (Admin only)',
    description: 'Deletes a category by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the category to delete',
    type: String,
  })
  @ApiResponse({
    status: 204,
    description: 'Category deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.categoryService.remove(id);
  }

  /**
   * Helper function to parse age from ageRange string
   * @param ageRange - e.g., "Age 5 - 8"
   * @returns minimum age number
   */
  private parseAgeFromRange(ageRange: string): number | null {
    if (!ageRange) return null;
    const matches = ageRange.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    return parseInt(matches[0], 10);
  }
}
