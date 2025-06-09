import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get user profile', description: 'Retrieve a user profile by ID.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'User profile returned.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUser(@Param('id') id: number) {
    // Example only: Replace with real logic
    return this.userService.getUser(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update user profile', description: 'Update a user profile by ID.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'User profile updated.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUser(@Param('id') id: number, @Body() body: any) {
    // Example only: Replace with real logic
    return this.userService.updateUser(id, body);
  }
}
