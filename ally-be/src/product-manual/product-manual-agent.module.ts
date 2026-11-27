import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsAgentModule } from 'src/analytics-agent/analytics-agent.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { BuilderModule } from 'src/builder/builder.module';
import { LlmModule } from 'src/llm/llm.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { ProductPlanningModule } from 'src/product-planning/product-planning.module';
import { ProductRoadmapModule } from 'src/product-roadmap/product-roadmap.module';
import { ManualAgentAdminController } from './controller/manual-agent-admin.controller';
import { ManualChatController } from './controller/manual-chat.controller';
import { ManualMcpController } from './controller/manual-mcp.controller';
import { ManualAgentKey } from './entity/manual-agent-key.entity';
import { ManualConversation } from './entity/manual-conversation.entity';
import { ManualRun } from './entity/manual-run.entity';
import { ProductManualModule } from './product-manual.module';
import { ManualAgentCore } from './service/manual-agent-core';
import { ManualAgentKeyService } from './service/manual-agent-key.service';
import { ManualAnalyticsPort } from './service/manual-analytics.port';
import { ManualChatToolsService } from './service/manual-chat-tools.service';
import { ManualChatService } from './service/manual-chat.service';
import { ManualCodeFreshnessService } from './service/manual-code-freshness.service';
import { ManualConversationService } from './service/manual-conversation.service';
import { ManualRunService } from './service/manual-run.service';
import { ManualSchedulerRegistrationService } from './service/manual-scheduler-registration.service';
import { ManualWeeklyAgentService } from './service/manual-weekly-agent.service';

/**
 * Product Manual, agent half (docs/product-manual.md → Chat, Agents, Proposal MCP): the chat and its
 * drafts tray, the weekly agent and its schedule, Run now, the coding agents' keys and the proposal
 * MCP. Both agents run one shared loop (`ManualAgentCore`) and write pages only through the core
 * module's `ManualPageService.write`.
 *
 * Model calls go through LlmAgentModule's provider factory with the model resolved by LlmModule's
 * resolver (registry rows `product-manual-chat` / `product-manual-agent`, tier REASONING). Redis,
 * config and FeatureToggleService come from global modules.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ManualConversation, ManualAgentKey, ManualRun]),
    ProductManualModule,
    // RoadmapDraftService (save a tray card), RoadmapItemReadService (search_roadmap).
    ProductRoadmapModule,
    // PlanSettingsService (assertRoadmapV2), RoadmapRoleService (roleOf).
    ProductPlanningModule,
    LlmModule,
    LlmAgentModule,
    LlmUsageModule,
    // BuilderGithubReadService: the github_* read tools, monorepo allow-list.
    BuilderModule,
    // AnalyticsAgentService, behind ManualAnalyticsPort (analytics_agent holders only).
    AnalyticsAgentModule,
  ],
  controllers: [
    ManualChatController,
    ManualAgentAdminController,
    ManualMcpController,
  ],
  providers: [
    ManualAgentCore,
    ManualAnalyticsPort,
    ManualChatToolsService,
    ManualConversationService,
    ManualChatService,
    ManualAgentKeyService,
    ManualRunService,
    ManualCodeFreshnessService,
    ManualWeeklyAgentService,
    ManualSchedulerRegistrationService,
  ],
  exports: [ManualWeeklyAgentService],
})
export class ProductManualAgentModule {}
