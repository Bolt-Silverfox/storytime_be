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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CategoryService } from './category.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto } from './category.dto';
import { AuthSessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get categories filtered by active kid profile age',
    description: 'Returns categories suitable for the active kid profile\'s age. Requires authentication.',
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
    // Extract active kid profile from request
    // Assuming the request contains activeKidProfile or similar
    const activeKidProfile = req.user?.activeKidProfile;

    if (!activeKidProfile) {
      throw new BadRequestException('No active kid profile found. Please select a kid profile.');
    }

    // Parse age from ageRange (e.g., "Age 5 - 8" -> use midpoint or min)
    const age = this.parseAgeFromRange(activeKidProfile.ageRange);

    if (!age) {
      throw new BadRequestException('Invalid age range in kid profile');
    }

    return this.categoryService.findAllByAge(age);
  }

  @Get('all')
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all categories (Admin only)',
    description: 'Returns all categories without age filtering. Admin access required.',
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

  @Get(':id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a single category by ID',
    description: 'Returns details of a specific category',
  })
  @ApiParam({
    name: 'id',
    description: 'Category ID',
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

  @Post()
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new category (Admin only)',
    description: 'Creates a new category with age group associations',
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
  async create(@Body() createCategoryDto: CreateCategoryDto): Promise<CategoryResponseDto> {
    return this.categoryService.create(createCategoryDto);
  }

  @Patch(':id')
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a category (Admin only)',
    description: 'Updates an existing category',
  })
  @ApiParam({
    name: 'id',
    description: 'Category ID',
    type: String,
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

  @Delete(':id')
  @UseGuards(AuthSessionGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category (Admin only)',
    description: 'Deletes a category',
  })
  @ApiParam({
    name: 'id',
    description: 'Category ID',
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
   * Parse age from ageRange string
   * @param ageRange - Age range string (e.g., "Age 5 - 8")
   * @returns Parsed age (minimum value from range)
   */
  private parseAgeFromRange(ageRange: string): number | null {
    if (!ageRange) return null;

    // Extract numbers from the age range string
    const matches = ageRange.match(/\d+/g);
    if (!matches || matches.length === 0) return null;

    // Return the first (minimum) age from the range
    return parseInt(matches[0], 10);
  }
}
