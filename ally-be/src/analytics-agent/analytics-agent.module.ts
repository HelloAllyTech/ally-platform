import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../config/config.module';
import { AiModule } from '../ai/ai.module';
import { AnalyticsAgentController } from './controller/analytics-agent.controller';
import { AnalyticsAuditController } from './controller/analytics-audit.controller';
import { AnalyticsAutomationController } from './controller/analytics-automation.controller';
import { AnalyticsAgentAudit } from './entity/analytics-agent-audit.entity';
import { AnalyticsAgentConversation } from './entity/analytics-agent-conversation.entity';
import { AnalyticsAgentMessage } from './entity/analytics-agent-message.entity';
import { AnalyticsAutomationAgentRun } from './entity/analytics-automation-agent-run.entity';
import { AnalyticsAutomationFinding } from './entity/analytics-automation-finding.entity';
import { AnalyticsAutomationRun } from './entity/analytics-automation-run.entity';
import { AnalyticsAgentConversationService } from './service/analytics-agent-conversation.service';
import { AnalyticsAgentService } from './service/analytics-agent.service';
import { AnalyticsAuditAgentService } from './service/analytics-audit-agent.service';
import { AnalyticsAuditSchedulerRegistrationService } from './service/analytics-audit-scheduler-registration.service';
import { AnalyticsAutomationBackendReviewAgent } from './service/analytics-automation-backend-review.agent';
import { AnalyticsAutomationDbtAgent } from './service/analytics-automation-dbt.agent';
import { AnalyticsAutomationGithubService } from './service/analytics-automation-github.service';
import { AnalyticsAutomationPosthogAgent } from './service/analytics-automation-posthog.agent';
import { AnalyticsAutomationPrReviewAgent } from './service/analytics-automation-pr-review.agent';
import { AnalyticsAutomationRunService } from './service/analytics-automation-run.service';
import { AnalyticsAutomationSchedulerRegistrationService } from './service/analytics-automation-scheduler-registration.service';
import { SchemaCatalogService } from './service/schema-catalog.service';
import { SqlExecutorService } from './service/sql-executor.service';

/**
 * The Analytics Agent — natural-language questions over the analytics tables.
 *
 * A module of its own rather than more files under `analytics/`: that module is
 * ~40 providers of fixed, reviewed aggregates, and this one is a single feature
 * whose whole point is that it writes its own queries. Keeping the trust
 * boundary (allowlist, guard, read-only executor) in one small module means the
 * files a reviewer has to read to convince themselves the feature is safe are
 * exactly the files in this directory.
 *
 * The agent reads existing tables through the shared DataSource and never
 * writes to them. The only tables it owns are the saved conversations — a
 * reader's own threads, so the Agent tab's history survives a reload. They are
 * never fed back into a prompt by the server; the client still replays `history`.
 */
@Module({
  // AiModule for AiService.getPromptOverrides: the planner and narrator
  // prompts are Skills Store prompts, sent to ally-ai with each call.
  imports: [
    AppConfigModule,
    AiModule,
    TypeOrmModule.forFeature([
      AnalyticsAgentConversation,
      AnalyticsAgentMessage,
      AnalyticsAgentAudit,
      AnalyticsAutomationRun,
      AnalyticsAutomationAgentRun,
      AnalyticsAutomationFinding,
    ]),
  ],
  controllers: [
    AnalyticsAgentController,
    AnalyticsAuditController,
    AnalyticsAutomationController,
  ],
  providers: [
    AnalyticsAgentService,
    AnalyticsAgentConversationService,
    AnalyticsAuditAgentService,
    AnalyticsAuditSchedulerRegistrationService,
    AnalyticsAutomationGithubService,
    AnalyticsAutomationBackendReviewAgent,
    AnalyticsAutomationPosthogAgent,
    AnalyticsAutomationDbtAgent,
    AnalyticsAutomationPrReviewAgent,
    AnalyticsAutomationRunService,
    AnalyticsAutomationSchedulerRegistrationService,
    SchemaCatalogService,
    SqlExecutorService,
  ],
  // Exported for in-process callers that ask a question on a user's behalf —
  // Builder's interview does, to ground a PRD in production numbers. The HTTP
  // surface stays feature-toggle-gated for a logged-in human; this is the same
  // service, reached without inventing a second credential type.
  // The audit service is exported for in-process callers; a run is started by
  // the audit controller or by AnalyticsAuditSchedulerRegistrationService.
  exports: [AnalyticsAgentService, AnalyticsAuditAgentService],
})
export class AnalyticsAgentModule {}
