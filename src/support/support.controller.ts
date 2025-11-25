import { Controller, Post, UseGuards, Req, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { AuthSessionGuard } from '../auth/auth.guard';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a support ticket (help & support)' })
  async create(@Req() req: any, @Body() body: CreateSupportTicketDto) {
    return this.supportService.createTicket(req.authUserData.userId, body.subject, body.message);
  }

  @Get('me')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my support tickets' })
  async list(@Req() req: any) {
    return this.supportService.listMyTickets(req.authUserData.userId);
  }

  @Get(':id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single ticket' })
  async get(@Req() req: any, @Param('id') id: string) {
    return this.supportService.getTicket(req.authUserData.userId, id);
  }
}
