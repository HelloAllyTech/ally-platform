import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { Chatbot } from '../chatbot/entity/chatbot.entity';
import { ChatbotMember } from '../chatbot/entity/chatbot-member.entity';
import { BotDraftEntity } from './entity/bot-draft.entity';
import { BotDraftEventsService } from './service/bot-draft-events.service';
import { BotDraftService } from './service/bot-draft.service';

/**
 * Agent-first onboarding (Agents v2, chunk 20a): the draft an owner builds with the builder agent,
 * the website crawl that fills it, and publishing it as a chatbot with its bot page. Its own module
 * because publishing reaches into both ChatbotModule and BotPageModule (which imports ChatbotModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BotDraftEntity, Chatbot, ChatbotMember]),
    ChatbotModule,
  ],
  providers: [BotDraftService, BotDraftEventsService],
  exports: [BotDraftService],
})
export class BotDraftModule {}
