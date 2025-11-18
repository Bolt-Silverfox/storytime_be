import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthSessionGuard } from '@/auth/guards/auth.guard';
import { AuthenticatedRequest } from '@/auth/guards/auth.guard';
import { UserService } from './user.service';
import { kidDto } from './dto/kid.dto';
import { updateKidDto } from './dto/updateKid.dto';
import { updateProfileDto } from './dto/updateProfile.dto';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // UPDATE PROFILE
  @Put('profile')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  @ApiBody({ type: updateProfileDto })
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: updateProfileDto,
  ) {
    return this.userService.updateProfile(req.authUserData['userId'], data);
  }

  // ADD KIDS
  @Post('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add kids to user account' })
  @ApiBody({ type: [kidDto] })
  async addKids(@Req() req: AuthenticatedRequest, @Body() data: kidDto[]) {
    return this.userService.addKids(req.authUserData['userId'], data);
  }

  // GET KIDS
  @Get('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all kids for user' })
  async getKids(@Req() req: AuthenticatedRequest) {
    return this.userService.getKids(req.authUserData['userId']);
  }

  // UPDATE KIDS
  @Put('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update kids information' })
  @ApiBody({ type: [updateKidDto] })
  async updateKids(
    @Req() req: AuthenticatedRequest,
    @Body() data: updateKidDto[],
  ) {
    return this.userService.updateKids(req.authUserData['userId'], data);
  }

  // DELETE KIDS
  @Delete('kids')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete kids from user account' })
  @ApiBody({ type: [String] })
  async deleteKids(@Req() req: AuthenticatedRequest, @Body() data: string[]) {
    return this.userService.deleteKids(req.authUserData['userId'], data);
  }
}
