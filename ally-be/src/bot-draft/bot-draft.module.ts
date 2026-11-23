import { Module } from '@nestjs/common';
import { ChatbotTemplateInstall } from './entity/chatbot-template-install.entity';
import { TemplateController } from './templates/template.controller';
import { TemplateService } from './templates/template.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { Chatbot } from '../chatbot/entity/chatbot.entity';
import { ChatbotDocument } from '../chatbot/entity/chatbot-document.entity';
import { ChatbotMember } from '../chatbot/entity/chatbot-member.entity';
import { AiModule } from '../ai/ai.module';
import { BotPageModule } from '../chatbot/bot-page/bot-page.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { BotDraftController } from './controller/bot-draft.controller';
import { DraftToolsController } from './controller/draft-tools.controller';
import { WorkingCopyController } from './controller/working-copy.controller';
import { WorkingCopyService } from './working-copy/working-copy.service';
import { BlankChatbotService } from './blank/blank-chatbot.service';
import { LibraryTemplateService } from './templates/library-template.service';
import { CopilotService } from './copilot/copilot.service';
import { SAFETY_APPLY_CHECK } from './working-copy/safety-apply-check';
import { JudgedSafetyApplyCheck } from './working-copy/judged-safety-apply-check';
import { CrisisSuiteService } from './checkup/crisis-suite.service';
import { CrisisSuiteController } from './checkup/crisis-suite.controller';
import { SafetyPackReleaseController } from './safety-pack/releases/safety-pack-release.controller';
import { SafetyPackReleaseService } from './safety-pack/releases/safety-pack-release.service';
import { BotDraftLikelyService } from './service/bot-draft-likely.service';
import { DraftChangeService } from './service/draft-change.service';
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
import { BotDraftPreviewService } from './service/bot-draft-preview.service';
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
      ChatbotTemplateInstall,
    ]),
    ChatbotModule,
    BotPageModule,
    KnowledgeBaseModule,
    AiModule,
    WhatsAppModule,
  ],
  controllers: [
    BotDraftController,
    DraftToolsController,
    // Stage 3: the working copy, templates and Copilot's sources.
    WorkingCopyController,
    ChatbotChangesController,
    AssistantHomeController,
    CheckupController,
    // Stage 4: the per-language crisis check the go-live gate reads.
    CrisisSuiteController,
    // Stage 9: safety pack releases (Ally curators).
    SafetyPackReleaseController,
    ScorecardController,
    TemplateController,
  ],
  providers: [
    BotDraftService,
    BotDraftEventsService,
    SiteCrawlService,
    BotDraftSessionService,
    BotDraftPublishService,
    // SB1: chat with the assistant while building it.
    BotDraftPreviewService,
    BotDraftLikelyService,
    DraftChangeService,
    AssistantHomeService,
    ChangeService,
    SourcesService,
    HomeListsService,
    ScorecardService,
    CheckupService,
    DraftCheckupService,
    CheckupCasesService,
    CrisisSuiteService,
    SafetyPackReleaseService,
    // Use-case templates (T1).
    TemplateService,
    // Stage 3: Create and Build.
    WorkingCopyService,
    BlankChatbotService,
    LibraryTemplateService,
    CopilotService,
    // Stage 4: patterns first, then the model judge and the crisis check, failing closed.
    { provide: SAFETY_APPLY_CHECK, useClass: JudgedSafetyApplyCheck },
    // CREDITS_GATE comes from the global BillingModule (LedgerCreditsGate, stage 6). Every
    // injection is optional: without it everything is available (the stage 1 stub's answer).
    // The crawl hands each batch of pages to the builder's fact extraction.
    { provide: CRAWL_LEARNER, useExisting: BotDraftSessionService },
  ],
  exports: [BotDraftService, SiteCrawlService],
})
export class BotDraftModule {}
