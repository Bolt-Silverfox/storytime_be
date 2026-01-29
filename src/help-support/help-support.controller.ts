import { Body, Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthSessionGuard, AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { HelpSupportService } from './help-support.service';

@ApiTags('Help & Support')
@Controller('help-support')
export class HelpSupportController {
  constructor(private readonly service: HelpSupportService) {}

  // GET /help-support/faqs
  @Get('faqs')
  getFaqs() {
    return {
      title: 'Find answers to frequently asked questions',
      items: this.service.getFaqs(),
    };
  }

  // POST /help-support/feedback
  @Post('feedback')
  submitFeedback(@Body() dto: CreateFeedbackDto) {
    return this.service.submitFeedback(dto);
  }

  // GET /help-support/contact
  @Get('contact')
  getContactInfo() {
    return this.service.getContactInfo();
  }

  // GET /help-support/terms
  @Get('terms')
  getTerms() {
    return this.service.getTerms();
  }

  // GET /help-support/privacy
  @Get('privacy')
  getPrivacy() {
    return this.service.getPrivacy();
  }

  // --- Support Tickets ---
  @Post('tickets')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a support ticket' })
  async createTicket(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return this.service.createTicket(req.authUserData.userId, dto);
  }

  @Get('tickets')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my support tickets' })
  async listMyTickets(@Req() req: AuthenticatedRequest) {
    return this.service.listMyTickets(req.authUserData.userId);
  }

  @Get('tickets/:id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single support ticket' })
  async getTicket(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.getTicket(req.authUserData.userId, id);
  }
}
