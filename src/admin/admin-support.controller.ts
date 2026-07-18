import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AdminSystemService } from './admin-system.service';
import { Admin } from './decorators/admin.decorator';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { CreateAdminTicketDto } from './dto/create-admin-ticket.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminSupportController {
  constructor(private readonly adminSystemService: AdminSystemService) {}

  // =====================
  // SUPPORT TICKETS
  // =====================

  @Get('support/tickets')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all support tickets' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getAllSupportTickets(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    const { page: p, limit: l } = PaginationUtil.sanitize(page, limit);
    const result = await this.adminSystemService.getAllSupportTickets(
      p,
      l,
      status,
    );
    return {
      statusCode: 200,
      message: 'Support tickets retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Patch('support/tickets/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update support ticket status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { status: { type: 'string', example: 'resolved' } },
    },
  })
  async updateSupportTicket(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const result = await this.adminSystemService.updateSupportTicket(
      id,
      status,
    );
    return {
      statusCode: 200,
      message: 'Support ticket updated',
      data: result,
    };
  }

  @Post('support/tickets')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a support ticket',
    description:
      'Creates a ticket on behalf of a user (if userId provided) or as the admin.',
  })
  @ApiBody({ type: CreateAdminTicketDto })
  @ApiCreatedResponse({
    description: 'Support ticket created',
    schema: {
      example: {
        statusCode: 201,
        message: 'Support ticket created',
        data: {
          id: 'ticket-123',
          userId: 'user-123',
          subject: 'Account issue',
          message: 'Details here',
          status: 'open',
          createdAt: '2024-01-01T00:00:00Z',
        },
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  async createSupportTicket(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateAdminTicketDto,
  ) {
    const creatorId = body.userId ?? req.authUserData.userId;
    const data = await this.adminSystemService.createSupportTicket(
      creatorId,
      body,
    );
    return {
      statusCode: 201,
      message: 'Support ticket created',
      data,
    };
  }
}
