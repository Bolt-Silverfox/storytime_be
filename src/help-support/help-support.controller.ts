import { Body, Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { HelpSupportService } from './help-support.service';
import { AuthSessionGuard } from '../auth/auth.guard';

@ApiTags('Help & Support')
@Controller('help-support')
export class HelpSupportController {
  constructor(private readonly service: HelpSupportService) { }

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
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit feedback / support ticket' })
  submitFeedback(@Req() req: any, @Body() dto: CreateFeedbackDto) {
    return this.service.submitFeedback(req.authUserData.userId, dto);
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
}
