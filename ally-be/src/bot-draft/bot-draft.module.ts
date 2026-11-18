import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { Chatbot } from '../chatbot/entity/chatbot.entity';
import { ChatbotDocument } from '../chatbot/entity/chatbot-document.entity';
import { ChatbotMember } from '../chatbot/entity/chatbot-member.entity';
import { AiModule } from '../ai/ai.module';
import { BotPageModule } from '../chatbot/bot-page/bot-page.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { BotDraftController } from './controller/bot-draft.controller';
import { ChatbotChangesController } from './controller/chatbot-changes.controller';
import { AssistantHomeController } from './home/assistant-home.controller';
import { AssistantHomeService } from './home/assistant-home.service';
import { ChangeService } from './home/change.service';
import { SourcesService } from './home/sources.service';
import { HomeListsService } from './home/home-lists.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ScorecardController } from './scorecard/scorecard.controller';
import { ScorecardService } from './scorecard/scorecard.service';
import { ChatbotMessageFeedback } from '../chatbot/entity/chatbot-message-feedback.entity';
import { CRAWL_LEARNER } from './crawl/site-crawl.service';
import { BotDraftPublishService } from './service/bot-draft-publish.service';
import { BotDraftSessionService } from './service/bot-draft-session.service';
import { SiteCrawlService } from './crawl/site-crawl.service';
import { BotDraftEntity } from './entity/bot-draft.entity';
import {
  ChatbotCheckupCase,
  ChatbotCheckupResult,
  ChatbotCheckupRun,
} from './entity/chatbot-checkup.entity';
import { CheckupController } from './checkup/checkup.controller';
import { CheckupService } from './checkup/checkup.service';
import { DraftCheckupService } from './checkup/draft-checkup.service';
import { CheckupCasesService } from './checkup/checkup-cases.service';
import { BotDraftEventsService } from './service/bot-draft-events.service';
import { BotDraftService } from './service/bot-draft.service';

/**
 * Agent-first onboarding (Agents v2, chunk 20a): the draft an owner builds with the builder agent,
 * the website crawl that fills it, and publishing it as a chatbot with its bot page. Its own module
 * because publishing reaches into both ChatbotModule and BotPageModule (which imports ChatbotModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BotDraftEntity,
      Chatbot,
      ChatbotMember,
      ChatbotDocument,
      ChatbotCheckupCase,
      ChatbotCheckupRun,
      ChatbotCheckupResult,
      ChatbotMessageFeedback,
    ]),
    ChatbotModule,
    BotPageModule,
    KnowledgeBaseModule,
    AiModule,
    WhatsAppModule,
  ],
  controllers: [
    BotDraftController,
    ChatbotChangesController,
    AssistantHomeController,
    CheckupController,
    ScorecardController,
  ],
  providers: [
    BotDraftService,
    BotDraftEventsService,
    SiteCrawlService,
    BotDraftSessionService,
    BotDraftPublishService,
    AssistantHomeService,
    ChangeService,
    SourcesService,
    HomeListsService,
    ScorecardService,
    CheckupService,
    DraftCheckupService,
    CheckupCasesService,
    // The crawl hands each batch of pages to the builder's fact extraction.
    { provide: CRAWL_LEARNER, useExisting: BotDraftSessionService },
  ],
  exports: [BotDraftService, SiteCrawlService],
})
export class BotDraftModule {}
