import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { LlmModule } from '../llm/llm.module';
import { PromptModule } from '../prompt/prompt.module';
import { GlobalSettings } from '../settings/entity/global-settings.entity';
import { GlobalSettingsRepository } from '../settings/repository/global-settings.repository';
import { WaKeywordTemplate } from '../whatsapp/entity/wa-keyword-template.entity';
import { ConnectorRegistry } from './connector/connector-registry';
import { ChatbotController } from './controller/chatbot.controller';
import { ConnectorController } from './controller/connector.controller';
import { AgentRuntimeRunner } from './engine/agent-runtime-runner.service';
import { ChatbotEngineService } from './engine/chatbot-engine.service';
import { ChatbotAudience } from './entity/chatbot-audience.entity';
import { ChatbotDocument } from './entity/chatbot-document.entity';
import { ChatbotMember } from './entity/chatbot-member.entity';
import { Chatbot } from './entity/chatbot.entity';
import { Connector } from './entity/connector.entity';
import { ChatbotContactIdentity } from './entity/chatbot-contact-identity.entity';
import { ChatbotContact } from './entity/chatbot-contact.entity';
import { ChatbotConversation } from './entity/chatbot-conversation.entity';
import { ChatbotMessage } from './entity/chatbot-message.entity';
import { AgentRuntimeAlertThrottle } from './service/agent-runtime-alert-throttle.service';
import { ChatbotAccessService } from './service/chatbot-access.service';
import { ChatbotAudienceService } from './service/chatbot-audience.service';
import { ChatbotReplyService } from './service/chatbot-reply.service';
import { ChatbotSettingsService } from './service/chatbot-settings.service';
import { ChatbotService } from './service/chatbot.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ConnectorService } from './service/connector.service';
import { ConversationService } from './service/conversation.service';
import { HandoverService } from './handover/handover.service';
import { InboxEventsService } from './inbox/inbox-events.service';
import { InboxController } from './inbox/inbox.controller';
import { InboxService } from './inbox/inbox.service';
import { NotificationModule } from '../notification/notification.module';

/**
 * Chatbots: configurable bots reached through connectors.
 *
 * Channel-agnostic by construction — nothing here imports a channel. Channels (the WhatsApp module
 * today) import THIS module: they register their connector type with ConnectorRegistry, resolve the
 * bot a message is for with ConnectorService, and hand the message to ChatbotEngineService, which
 * decides the reply without sending or storing anything.
 *
 * `GlobalSettingsRepository` is registered locally because SettingsModule does not export it; a
 * TypeORM repository is a stateless wrapper over the shared DataSource, so a second instance is safe.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Chatbot,
      ChatbotMember,
      ChatbotAudience,
      ChatbotDocument,
      Connector,
      ChatbotContact,
      ChatbotContactIdentity,
      ChatbotConversation,
      ChatbotMessage,
      WaKeywordTemplate,
      GlobalSettings,
    ]),
    AiModule,
    PromptModule,
    LlmModule,
    KnowledgeBaseModule,
    // The inbox's "nobody opened it" email (chunk 11a).
    NotificationModule,
  ],
  controllers: [ChatbotController, ConnectorController, InboxController],
  providers: [
    GlobalSettingsRepository,
    ConnectorRegistry,
    ChatbotAccessService,
    ChatbotAudienceService,
    ChatbotSettingsService,
    ChatbotReplyService,
    ChatbotEngineService,
    AgentRuntimeRunner,
    ConnectorService,
    ChatbotService,
    AgentRuntimeAlertThrottle,
    ConversationService,
    InboxEventsService,
    InboxService,
    HandoverService,
  ],
  exports: [
    // The Checkup (chunk 20a-2) asks questions through Preview's path.
    ChatbotService,
    ConnectorRegistry,
    ConnectorService,
    ChatbotAccessService,
    ChatbotSettingsService,
    ChatbotReplyService,
    ChatbotEngineService,
    AgentRuntimeAlertThrottle,
    ConversationService,
    // Channels report each decision and deliver the team's replies (chunk 11a).
    HandoverService,
    InboxEventsService,
    // The assistant home's WhatsApp audience list (chunk 20d-2).
    ChatbotAudienceService,
  ],
})
export class ChatbotModule {}
