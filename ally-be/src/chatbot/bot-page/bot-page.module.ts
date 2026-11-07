import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../../aws/aws.module';
import { ChatbotModule } from '../chatbot.module';
import { ChatbotPageAccess } from '../entity/chatbot-page-access.entity';
import { ChatbotPage } from '../entity/chatbot-page.entity';
import { Chatbot } from '../entity/chatbot.entity';
import { BotPageAccessService } from './bot-page-access.service';
import { BotPageAdminController } from './bot-page-admin.controller';
import { BotPageRateLimitService } from './bot-page-rate-limit.service';
import { BotPageService } from './bot-page.service';

/**
 * The bot page (Agents v2, chunk 12b): a bot's branded chat link, the Bot page tab behind it, and
 * the public API a visitor's browser talks to. A channel like WhatsApp: it imports ChatbotModule and
 * hands each message to the engine; ChatbotModule knows nothing about it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotPage, ChatbotPageAccess, Chatbot]),
    ChatbotModule,
    AwsModule,
  ],
  controllers: [BotPageAdminController],
  providers: [BotPageService, BotPageAccessService, BotPageRateLimitService],
  exports: [BotPageService],
})
export class BotPageModule {}
