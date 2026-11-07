import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../../aws/aws.module';
import { NotificationModule } from '../../notification/notification.module';
import { WaUnansweredQuestion } from '../../whatsapp/entity/wa-unanswered-question.entity';
import { ChatbotModule } from '../chatbot.module';
import { ChatbotPageAccess } from '../entity/chatbot-page-access.entity';
import { ChatbotPage } from '../entity/chatbot-page.entity';
import { Chatbot } from '../entity/chatbot.entity';
import { BotPageAccessService } from './bot-page-access.service';
import { BotPageAdminController } from './bot-page-admin.controller';
import { BotPageGuardMiddleware } from './bot-page-guard.middleware';
import { BotPageOtpService } from './bot-page-otp.service';
import { BotPagePublicController } from './bot-page-public.controller';
import { BotPagePublicService } from './bot-page-public.service';
import { BotPageRateLimitService } from './bot-page-rate-limit.service';
import { BotPageVisitorService } from './bot-page-visitor.service';
import { BotPageService } from './bot-page.service';
import { TurnstileService } from './turnstile.service';

/**
 * The bot page (Agents v2, chunk 12b): a bot's branded chat link, the Bot page tab behind it, and
 * the public API a visitor's browser talks to. A channel like WhatsApp: it imports ChatbotModule and
 * hands each message to the engine; ChatbotModule knows nothing about it.
 *
 * Unanswered questions go to `wa_unanswered_questions` (it has no foreign keys, and the dashboard's
 * Unanswered tab reads it), with the shared store's conversation and message ids.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatbotPage,
      ChatbotPageAccess,
      Chatbot,
      WaUnansweredQuestion,
    ]),
    JwtModule.register({}),
    ChatbotModule,
    AwsModule,
    NotificationModule,
  ],
  controllers: [BotPageAdminController, BotPagePublicController],
  providers: [
    BotPageService,
    BotPageAccessService,
    BotPageRateLimitService,
    BotPageVisitorService,
    BotPageOtpService,
    TurnstileService,
    BotPagePublicService,
  ],
  // The access service too: onboarding's publish (chunk 20a) writes the page's list through it.
  exports: [BotPageService, BotPageAccessService],
})
export class BotPageModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BotPageGuardMiddleware).forRoutes(BotPagePublicController);
  }
}
