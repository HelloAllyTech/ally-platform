import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { BuilderPullRequest } from 'src/builder/entity/builder-pull-request.entity';
import { NotificationModule } from 'src/notification/notification.module';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { AppConfigModule } from 'src/config/config.module';
import { LlmModule } from 'src/llm/llm.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { ProductRoadmapModule } from 'src/product-roadmap/product-roadmap.module';
import { PmAgentController } from './controller/pm-agent.controller';
import { PmAgentGateway } from './gateway/pm-agent.gateway';
import { PmAgentSettings } from './entity/pm-agent-settings.entity';
import { PmAgentRun } from './entity/pm-agent-run.entity';
import { PmAgentRunStep } from './entity/pm-agent-run-step.entity';
import { PmAgentCard } from './entity/pm-agent-card.entity';
import { PmAgentCardEvent } from './entity/pm-agent-card-event.entity';
import { PmAgentEvidence } from './entity/pm-agent-evidence.entity';
import { PmAgentMemory } from './entity/pm-agent-memory.entity';
import { PmAgentFeedback } from './entity/pm-agent-feedback.entity';
import { PmAgentOutbox } from './entity/pm-agent-outbox.entity';
import { PmAgentSignal } from './entity/pm-agent-signal.entity';
import { PmAgentOutcome } from './entity/pm-agent-outcome.entity';
import { PmAgentLaneStat } from './entity/pm-agent-lane-stat.entity';
import { PmAgentCardRepository } from './repository/pm-agent-card.repository';
import {
  PmAgentEvidenceRepository,
  PmAgentFeedbackRepository,
  PmAgentLaneStatRepository,
  PmAgentMemoryRepository,
  PmAgentOutboxRepository,
  PmAgentOutcomeRepository,
  PmAgentRunRepository,
  PmAgentRunStepRepository,
  PmAgentSettingsRepository,
  PmAgentSignalRepository,
} from './repository/pm-agent.repositories';
import { PmAgentBudgetService } from './service/pm-agent-budget.service';
import { PmAgentBuilderPort } from './service/pm-agent-builder-port.service';
import { PmAgentBuildService } from './service/pm-agent-build.service';
import { PmAgentCardService } from './service/pm-agent-card.service';
import { PmAgentEventsService } from './service/pm-agent-events.service';
import { PmAgentMemoryService } from './service/pm-agent-memory.service';
import { PmAgentPresenterService } from './service/pm-agent-presenter.service';
import { PM_AGENT_RUN_TRIGGER } from './service/pm-agent-run-trigger';
import {
  PmAgentRunSchedulerService,
  PmAgentRunService,
} from './service/pm-agent-run.service';
import { PmAgentLlmService } from './pipeline/pm-agent-llm.service';
import { PmAgentPipelineStore } from './pipeline/pm-agent-pipeline.store';
import { PmAgentContextService } from './pipeline/pm-agent-context.service';
import { PmLaneToolsService } from './lane/pm-lane-tools.service';
import { PmAgentSchedulerService } from './service/pm-agent-scheduler.service';
import { PmAgentSettingsService } from './service/pm-agent-settings.service';
import { PmAgentStateService } from './service/pm-agent-state.service';

/**
 * PM Agent (docs/pm-agent.md): the admin AI product manager. This module is the
 * deterministic half — state, queue, budget read-out, the card state machine, the accept
 * outbox and Builder wiring, the realtime feed — and the generation pipeline (lanes, gate,
 * critic, ranker, Persister, daily scheduler: pipeline/, lane/, gate/, learning/), which
 * provides PM_AGENT_RUN_TRIGGER through PmAgentRunService.
 *
 * Builder is reached lazily through ModuleRef (PmAgentBuilderPort), never imported: Builder's
 * module graph reaches UX Signals and much else, and Builder must not depend on us either —
 * the `pm_agent` requester registers itself at init, as the Debrief PM agent's does. Builder's
 * tables are read directly (TypeOrmModule.forFeature), writes go through its services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PmAgentSettings,
      PmAgentRun,
      PmAgentRunStep,
      PmAgentCard,
      PmAgentCardEvent,
      PmAgentEvidence,
      PmAgentMemory,
      PmAgentFeedback,
      PmAgentOutbox,
      PmAgentSignal,
      PmAgentOutcome,
      PmAgentLaneStat,
      BuilderSession,
      BuilderSettings,
      BuilderPullRequest,
    ]),
    // RoadmapOpportunityRepository + RoadmapProductGoalRepository (already exported).
    ProductRoadmapModule,
    // SlackService, for the circuit breaker's one notification.
    NotificationModule,
    // The pipeline: the 15 exported analytics read services (lane tools), prompts, model
    // resolution + provider adapters, and llm_usage metering.
    AppConfigModule,
    AnalyticsModule,
    PromptModule,
    LlmModule,
    LlmAgentModule,
    LlmUsageModule,
  ],
  controllers: [PmAgentController],
  providers: [
    PmAgentSettingsRepository,
    PmAgentRunRepository,
    PmAgentRunStepRepository,
    PmAgentCardRepository,
    PmAgentEvidenceRepository,
    PmAgentMemoryRepository,
    PmAgentFeedbackRepository,
    PmAgentOutboxRepository,
    PmAgentOutcomeRepository,
    PmAgentLaneStatRepository,
    PmAgentSignalRepository,
    PmAgentEventsService,
    PmAgentBudgetService,
    PmAgentSettingsService,
    PmAgentPresenterService,
    PmAgentCardService,
    PmAgentMemoryService,
    PmAgentStateService,
    PmAgentBuilderPort,
    PmAgentBuildService,
    PmAgentSchedulerService,
    PmAgentGateway,
    PmAgentLlmService,
    PmAgentPipelineStore,
    PmAgentContextService,
    PmLaneToolsService,
    PmAgentRunService,
    PmAgentRunSchedulerService,
    { provide: PM_AGENT_RUN_TRIGGER, useExisting: PmAgentRunService },
  ],
  exports: [
    PmAgentSettingsRepository,
    PmAgentRunRepository,
    PmAgentRunStepRepository,
    PmAgentCardRepository,
    PmAgentEvidenceRepository,
    PmAgentMemoryRepository,
    PmAgentFeedbackRepository,
    PmAgentOutcomeRepository,
    PmAgentLaneStatRepository,
    PmAgentSignalRepository,
    PmAgentEventsService,
    PmAgentBudgetService,
    PmAgentSettingsService,
    PmAgentCardService,
  ],
})
export class PmAgentModule {}
