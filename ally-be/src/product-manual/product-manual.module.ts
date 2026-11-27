import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { ProductPlanningModule } from 'src/product-planning/product-planning.module';
import { ProductRoadmapModule } from 'src/product-roadmap/product-roadmap.module';
import { ManualAdminController } from './controller/manual-admin.controller';
import { ManualController } from './controller/manual.controller';
import { ManualAgentKey } from './entity/manual-agent-key.entity';
import { ManualConversation } from './entity/manual-conversation.entity';
import { ManualLink } from './entity/manual-link.entity';
import { ManualPage } from './entity/manual-page.entity';
import { ManualProposal } from './entity/manual-proposal.entity';
import { ManualRevision } from './entity/manual-revision.entity';
import { ManualRun } from './entity/manual-run.entity';
import { ManualSettings } from './entity/manual-settings.entity';
import { ManualBudgetService } from './service/manual-budget.service';
import { ManualChangesService } from './service/manual-changes.service';
import { ManualGraphService } from './service/manual-graph.service';
import { ManualImportService } from './service/manual-import.service';
import { ManualPageService } from './service/manual-page.service';
import { ManualProposalService } from './service/manual-proposal.service';
import { ManualScrubService } from './service/manual-scrub.service';
import { ManualSearchService } from './service/manual-search.service';
import { ManualSettingsService } from './service/manual-settings.service';
import { ManualStateService } from './service/manual-state.service';

/**
 * Product Manual, core half (docs/product-manual.md): the DB-backed pages, their revisions, links,
 * search, map, change log, settings, budget and proposals, plus the reader and admin controllers. The
 * chat, weekly agent and proposal MCP live in the agent half, which imports this module and uses the
 * exported services (`ManualPageService.write` is the only way a page's text changes).
 *
 * FeatureToggleService (the state's analytics / admin flags) comes from the global AuthorizationModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ManualPage,
      ManualRevision,
      ManualLink,
      ManualProposal,
      ManualSettings,
      ManualRun,
      ManualAgentKey,
      ManualConversation,
    ]),
    // RoadmapDraftService + RoadmapItemReadService, for the chat half.
    ProductRoadmapModule,
    // PlanSettingsService (assertRoadmapV2) and RoadmapRoleService (roleOf).
    ProductPlanningModule,
    // llm_usage, the source of the budget's spend figure (read by raw SQL; the module is here so
    // the chat half can record usage through the same import).
    LlmUsageModule,
  ],
  controllers: [ManualController, ManualAdminController],
  providers: [
    ManualScrubService,
    ManualChangesService,
    ManualPageService,
    ManualSearchService,
    ManualGraphService,
    ManualSettingsService,
    ManualBudgetService,
    ManualProposalService,
    ManualStateService,
    ManualImportService,
  ],
  exports: [
    TypeOrmModule,
    ManualPageService,
    ManualSearchService,
    ManualGraphService,
    ManualChangesService,
    ManualScrubService,
    ManualBudgetService,
    ManualSettingsService,
    ManualStateService,
    ManualImportService,
    ManualProposalService,
  ],
})
export class ProductManualModule {}
