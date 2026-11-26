import { AssistantSeatsController } from './controller/assistant-seats.controller';
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
import { AlertOutboxService } from './safety/alert-outbox.service';
import { AssistantsMonitoringService } from './safety/assistants-monitoring.service';
import { CrisisAlertService } from './safety/crisis-alert.service';
import { LateCrisisService } from './safety/late-crisis.service';
import { GoLiveController } from './safety/go-live.controller';
import { GoLiveGateService } from './safety/go-live-gate.service';
import { GoLiveBackfillService } from './safety/go-live-backfill.service';
import { SafetyStateService } from './safety/safety-state.service';
import { CrisisBackfillService } from './safety/crisis-backfill.service';
import { HandoverService } from './handover/handover.service';
import { InboxEventsService } from './inbox/inbox-events.service';
import { InboxController } from './inbox/inbox.controller';
import { InboxService } from './inbox/inbox.service';
import { NotificationModule } from '../notification/notification.module';
import { AgentGatewayController } from './agent-tools/agent-gateway.controller';
import { AgentGatewayService } from './agent-tools/agent-gateway.service';
import { ActionPartsService } from './actions/action-parts.service';
import { ActionTokenService } from './actions/action-token.service';
import { ActionsService } from './actions/actions.service';
import { AgentRunTokenService } from './agent-tools/agent-run-token.service';
import { HandOverTool } from './agent-tools/hand-over.tool';
import { ListConsentService } from './agent-tools/list-consent.service';
import { ListToolsService } from './agent-tools/list-tools.service';
import { AGENT_GATEWAY_TOOLS, AgentToolRegistry } from './agent-tools/tools';
import { SendSourceFileTool } from './agent-tools/send-source-file.tool';
import { ToolRun } from './entity/tool-run.entity';
import { MemoryEntry } from './entity/memory-entry.entity';
import { MemoryService } from './memory/memory.service';
import { SummaryService } from './memory/summary.service';
import { Collection } from './entity/collection.entity';
import { CollectionConstraint } from './entity/collection-constraint.entity';
import { CollectionField } from './entity/collection-field.entity';
import { CollectionRecord } from './entity/collection-record.entity';
import { RecordEvent } from './entity/record-event.entity';
import { RecordLink } from './entity/record-link.entity';
import { ListController } from './lists/list.controller';
import { ListCsvService } from './lists/list-csv.service';
import { ListDefinitionsService } from './lists/list-definitions.service';
import { ListOwnerService } from './lists/list-owner.service';
import { ListRecordsService } from './lists/list-records.service';
import { ChatbotInvite } from './entity/chatbot-invite.entity';
import { ResponderAgreement } from './entity/responder-agreement.entity';
import { ChatbotMembersService } from './members/chatbot-members.service';
import { ChatbotInvitesService } from './members/chatbot-invites.service';
import { ResponderAgreementService } from './members/responder-agreement.service';
import {
  AssistantMembersController,
  ChatbotTeamController,
  PublicAssistantInvitesController,
} from './members/chatbot-team.controller';

import { AssistantRetentionService } from './privacy/assistant-retention.service';
import { CustomerErasureService } from './privacy/customer-erasure.service';
import { ChatPrivacyService } from './privacy/chat-privacy.service';
import { MemoryConsentService } from './privacy/memory-consent.service';
import { AnswerConflictService } from './knowledge/answer-conflict.service';
import { KnowledgeFreshnessService } from './knowledge/knowledge-freshness.service';
import { SafetyTranslationsService } from './languages/safety-translations.service';
import { QuickReplyCopyService } from './quick-replies/quick-reply-copy.service';
import { ChatbotSharingService } from './sharing/chatbot-sharing.service';
import {
  ChatbotKnowledgeController,
  KnowledgePoolController,
} from './sharing/chatbot-knowledge.controller';
import { StaffAssistantsController } from './sharing/staff-assistants.controller';
import { LlmAgentModule } from '../llm-agent/llm-agent.module';
import { ChatbotAccessGrant } from './entity/chatbot-access-grant.entity';
import { ChatbotStaffView } from './entity/chatbot-staff-view.entity';
import { ChatbotStaffAccessService } from './staff/chatbot-staff-access.service';
import {
  ChatbotStaffAccessController,
  StaffChatbotsController,
} from './staff/chatbot-staff-access.controller';

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
      ToolRun,
      MemoryEntry,
      // Lists (chunk 5a).
      Collection,
      CollectionField,
      CollectionConstraint,
      CollectionRecord,
      RecordLink,
      RecordEvent,
      WaKeywordTemplate,
      GlobalSettings,
      // Team invites and the responder agreement (Stage 1b).
      ChatbotInvite,
      ResponderAgreement,
      // Stage 8: owners' grants to Ally staff, and the staff view log.
      ChatbotAccessGrant,
      ChatbotStaffView,
    ]),
    AiModule,
    PromptModule,
    LlmModule,
    KnowledgeBaseModule,
    // The inbox's "nobody opened it" email (chunk 11a).
    NotificationModule,
    // Stage 5: the knowledge conflict judge.
    LlmAgentModule,
  ],
  controllers: [
    AssistantSeatsController,
    ChatbotController,
    ConnectorController,
    InboxController,
    AgentGatewayController,
    ListController,
    // The team: remove, leave, transfer, invites, responder agreement (Stage 1b).
    ChatbotTeamController,
    AssistantMembersController,
    PublicAssistantInvitesController,
    // Customer data, knowledge and sharing (stage 5).
    ChatbotKnowledgeController,
    KnowledgePoolController,
    StaffAssistantsController,
    // Stage 8: staff read-only view (owner grants + who looked; staff search).
    ChatbotStaffAccessController,
    StaffChatbotsController,
    // Safety core (stage 4): go-live checklist, safety terms, unpublish backfill.
    GoLiveController,
  ],
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
    // Crisis flags, the alert outbox and the one-minute job (assistants build, stage 1b).
    AlertOutboxService,
    AssistantsMonitoringService,
    CrisisAlertService,
    CrisisBackfillService,
    // WA-A §0a: a crisis verdict that arrives after the reply still flags and alerts.
    LateCrisisService,
    // Safety core (stage 4): the go-live gate on every path, and the D10 backfill.
    SafetyStateService,
    GoLiveGateService,
    GoLiveBackfillService,
    // The agent's tool gateway (chunk 3b). A new tool is one provider here, listed below.
    AgentRunTokenService,
    AgentGatewayService,
    HandOverTool,
    SendSourceFileTool,
    {
      provide: AGENT_GATEWAY_TOOLS,
      // WA-A §2: send_source_file, opt-in per assistant like hand_over.
      useFactory: (handOver: HandOverTool, sendFile: SendSourceFileTool) => [
        handOver,
        sendFile,
      ],
      inject: [HandOverTool, SendSourceFileTool],
    },
    AgentToolRegistry,
    ListToolsService,
    ListConsentService,
    // Act by tap (BT1): tokens, the parts a reply carries, and taps answered in code.
    ActionTokenService,
    ActionPartsService,
    ActionsService,
    // Lists (chunk 5a): the engine 6's tools and 5b's screens use.
    ListRecordsService,
    ListDefinitionsService,
    ListCsvService,
    // The owner's Lists section (chunk 5b): ready-made lists, Repeat weekly, switches.
    ListOwnerService,
    // Memory, light (chunk 8a): what it remembers about each person, and the rolling summary.
    MemoryService,
    SummaryService,
    // The team (Stage 1b).
    ChatbotMembersService,
    ChatbotInvitesService,
    ResponderAgreementService,
    // Customer data, knowledge and sharing (stage 5).
    AssistantRetentionService,
    CustomerErasureService,
    ChatPrivacyService,
    MemoryConsentService,
    AnswerConflictService,
    KnowledgeFreshnessService,
    SafetyTranslationsService,
    QuickReplyCopyService,
    ChatbotSharingService,
    // Stage 8: the staff read-only view (ChatbotAccessService takes it optionally).
    ChatbotStaffAccessService,
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
    CrisisAlertService,
    AlertOutboxService,
    InboxEventsService,
    // Stage 4: publish and the page toggle go through the same go-live gate.
    GoLiveGateService,
    SafetyStateService,
    // The assistant home's WhatsApp audience list (chunk 20d-2).
    ChatbotAudienceService,
    // Lists (chunk 5a).
    ListRecordsService,
    ListDefinitionsService,
    // Use-case templates install lists through it (T1).
    ListOwnerService,
    // The bot page's confirmation card reads the record a reply booked (chunk 6b).
    ListToolsService,
    // Channels redeem taps and build a reply's chips and cards (BT1).
    ActionsService,
    ActionPartsService,
    // Channels apply memory after a reply (chunk 8a).
    MemoryService,
    SummaryService,
    // The home's team list replaces the team through it (Stage 1b).
    ChatbotMembersService,
    // Stage 5: the WhatsApp retention task delegates to the per-chatbot sweep; the engine, the bot
    // page and WhatsApp inbound reach erase, consent, conflicts and languages through these.
    AssistantRetentionService,
    CustomerErasureService,
    ChatPrivacyService,
    MemoryConsentService,
    AnswerConflictService,
    KnowledgeFreshnessService,
    SafetyTranslationsService,
    QuickReplyCopyService,
  ],
})
export class ChatbotModule {}
