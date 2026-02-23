import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/render';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { FeedbackNotificationTemplate } from '@/notification/templates/feedback-notification';
import { EnvConfig } from '@/shared/config/env.validation';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

@Injectable()
export class HelpSupportService {
  private readonly logger = new Logger(HelpSupportService.name);
  private readonly feedbackRecipientEmail: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {
    this.feedbackRecipientEmail = this.configService.get(
      'DEFAULT_SENDER_EMAIL',
      { infer: true },
    );
  }
  // --- FAQs List ---
  getFaqs() {
    return [
      {
        question: 'Are the stories safe for my kids?',
        answer: 'Yes! All stories are age-appropriate and reviewed for safety.',
      },
      {
        question: 'Do I need internet to listen?',
        answer:
          'You only need internet to download a story. After that, you can listen offline.',
      },
      {
        question: 'How do I upgrade my subscription?',
        answer:
          'Log into your account, go to profile → subscription → choose a premium plan and follow the prompts.',
      },
      {
        question: 'Can parents track reading progress?',
        answer:
          'Yes, parents can view reading/listening progress inside their dashboard.',
      },
    ];
  }

  // --- Store feedback suggestion ---
  async submitFeedback(dto: CreateFeedbackDto) {
    const { fullname, email, message } = dto;
    const submittedAt = new Date().toISOString();

    // Render the feedback notification email template
    const feedbackHtml = await render(
      FeedbackNotificationTemplate({
        fullname,
        email,
        message,
        submittedAt,
      }),
    );

    try {
      // Queue email to team
      await this.notificationService.queueEmail(
        this.feedbackRecipientEmail,
        `New Feedback from ${fullname}`,
        feedbackHtml,
        { templateName: 'feedback-notification' },
      );

      this.logger.log(`Feedback submitted by ${email}`);

      return {
        message:
          'Thank you for your feedback! We appreciate you taking the time to help us improve.',
      };
    } catch (error) {
      this.logger.error(
        `Failed to process feedback from ${email}`,
        ErrorHandler.extractStack(error) ?? String(error),
      );
      // Still return success to user - feedback was received even if email failed
      return {
        message: 'Thank you for your feedback!',
      };
    }
  }

  // --- Contact Info ---
  getContactInfo() {
    return {
      email: 'team@storytime.app',
      phone: '+234 801 234 5678',
    };
  }

  // --- Terms ---
  getTerms() {
    return [
      {
        title: 'Introduction and Acceptance',
        content:
          'This document ("Terms") constitutes a legally binding agreement between you (the "User," "Parent," or "Guardian") and StoryTime4Kids ("Company," "We," or "Us") regarding your access and use of our digital library and app service (the "Service"). By accessing, using, or subscribing to the Service, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you do not agree to these Terms, you may not use the Service.',
      },
      {
        title: 'The Service & Age Restrictions',
        content:
          "StoryTime4Kids provides access to a curated digital library of audio and video content designed to enhance children's literacy and imagination. The Service is intended for use by adults for children under 18. Users must be 18 years of age or older to create an account, make payments, and agree to these Terms.",
      },
      {
        title: 'Subscription, Payments, and Free Trial',
        content:
          'Subscription: We offer various subscription models (e.g., Monthly, Annual, Family Legacy).\n' +
          'Automatic Renewal: All paid subscriptions automatically renew at the then-current rate unless you cancel the subscription prior to the end of the current billing period.\n' +
          'Free Trial: We may offer a free trial (e.g., 7 or 14 days). IMPORTANT: Your payment method will be charged automatically immediately following the end of your free trial period unless you cancel before the trial expires.',
      },
      {
        title: 'Intellectual Property (IP)',
        content:
          'All content, including stories, narration, illustrations, trademarks, and software, is the property of StoryTime4Kids or its licensors and is protected by copyright and intellectual property laws. Content is licensed to you for personal, non-commercial use only. You may not copy, modify, transmit, or publicly display any content without express written permission.',
      },
      {
        title: 'User Conduct & Security',
        content:
          'You are responsible for safeguarding your account login information and for all activity under your account. You agree not to use the Service for any unlawful purpose, including sharing your account credentials with non-subscribers beyond the limits allowed by your subscription plan.',
      },
      {
        title: 'Termination',
        content:
          'We reserve the right to immediately terminate or suspend your access to the Service, without prior notice or liability, if you breach any part of these Terms, including but not limited to non-payment or unauthorized sharing of content.',
      },
      {
        title: 'Governing Law and Disputes',
        content:
          'These Terms shall be governed by the laws of your jurisdiction (e.g., the State of California), without regard to its conflict of law provisions. Any disputes must first be attempted to be resolved through good-faith negotiation or binding arbitration as set forth in the full policy document.',
      },
    ];
  }

  // --- Privacy Policy ---
  getPrivacy() {
    return {
      title: 'Privacy Policy',
      content: `This Privacy Policy describes how StoryTime collects, uses, and protects your information... (fill in your real content).`,
    };
  }

  // --- Support Tickets ---
  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        message: dto.message,
      },
    });
  }

  async listMyTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTicket(userId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }
}
