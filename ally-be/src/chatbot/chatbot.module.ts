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
import { AgentShadowRun } from './entity/agent-shadow-run.entity';
import { ChatbotAudience } from './entity/chatbot-audience.entity';
import { ChatbotDocument } from './entity/chatbot-document.entity';
import { ChatbotMember } from './entity/chatbot-member.entity';
import { Chatbot } from './entity/chatbot.entity';
import { Connector } from './entity/connector.entity';
import { AgentRuntimeAlertThrottle } from './service/agent-runtime-alert-throttle.service';
import { ChatbotAccessService } from './service/chatbot-access.service';
import { ChatbotAudienceService } from './service/chatbot-audience.service';
import { ChatbotReplyService } from './service/chatbot-reply.service';
import { ChatbotSettingsService } from './service/chatbot-settings.service';
import { ChatbotShadowService } from './service/chatbot-shadow.service';
import { ChatbotService } from './service/chatbot.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ConnectorService } from './service/connector.service';

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
      AgentShadowRun,
      Chatbot,
      ChatbotMember,
      ChatbotAudience,
      ChatbotDocument,
      Connector,
      WaKeywordTemplate,
      GlobalSettings,
    ]),
    AiModule,
    PromptModule,
    LlmModule,
    KnowledgeBaseModule,
  ],
  controllers: [ChatbotController, ConnectorController],
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
    ChatbotShadowService,
    AgentRuntimeAlertThrottle,
  ],
  exports: [
    ConnectorRegistry,
    ConnectorService,
    ChatbotAccessService,
    ChatbotSettingsService,
    ChatbotReplyService,
    ChatbotEngineService,
    ChatbotShadowService,
    AgentRuntimeAlertThrottle,
  ],
})
export class ChatbotModule {}
