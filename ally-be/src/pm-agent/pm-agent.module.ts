import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { PmAgentRoadmapPort } from './service/pm-agent-roadmap-port.service';
import { PmAgentFilingService } from './service/pm-agent-filing.service';
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
import {
  PM_IMPACT_STORE,
  PM_METRIC_SOURCES,
  PmAgentImpactService,
} from './impact/pm-agent-impact.service';
import { PmAgentImpactScheduler } from './impact/pm-agent-impact.scheduler';
import { PmAgentLessonsController } from './lessons/pm-lessons.controller';
import {
  PmAgentLessonsScheduler,
  PmAgentLessonsService,
} from './lessons/pm-lessons.service';
import { PmLessonsSqlStore } from './lessons/pm-lessons.store';
import { PmImpactStore } from './impact/pm-impact.store';
import { PmMetricSourcesService } from './impact/pm-metric-sources.service';

/**
 * PM Agent (docs/pm-agent.md): the admin AI product manager. It proposes; it never builds.
 * This module is the deterministic half — state, queue, budget read-out, the card state
 * machine, the accept outbox that files accepted cards to the roadmap, the realtime feed —
 * and the generation pipeline (lanes, gate, critic, ranker, Persister, daily scheduler:
 * pipeline/, lane/, gate/, learning/), which provides PM_AGENT_RUN_TRIGGER through
 * PmAgentRunService.
 *
 * The roadmap is the only thing it writes outside its own tables, and only through the
 * roadmap's own services (PmAgentRoadmapPort). Builder is no longer called; the no-op
 * `pm_agent` requester stays registered for sessions created before 2026-11-17.
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
    ]),
    // RoadmapOpportunityRepository + RoadmapProductGoalRepository (already exported); the
    // roadmap's create, readiness-token and duplicate services via ModuleRef (PmAgentRoadmapPort).
    ProductRoadmapModule,
    // The pipeline: the 15 exported analytics read services (lane tools), prompts, model
    // resolution + provider adapters, and llm_usage metering.
    AppConfigModule,
    AnalyticsModule,
    PromptModule,
    LlmModule,
    LlmAgentModule,
    LlmUsageModule,
  ],
  controllers: [PmAgentController, PmAgentLessonsController],
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
    PmAgentRoadmapPort,
    PmAgentFilingService,
    PmAgentSchedulerService,
    PmAgentGateway,
    PmAgentLlmService,
    PmAgentPipelineStore,
    PmAgentContextService,
    PmLaneToolsService,
    PmAgentRunService,
    PmAgentRunSchedulerService,
    { provide: PM_AGENT_RUN_TRIGGER, useExisting: PmAgentRunService },
    // Impact checks (+14 / +30 d): impact/.
    PmImpactStore,
    PmMetricSourcesService,
    { provide: PM_IMPACT_STORE, useExisting: PmImpactStore },
    { provide: PM_METRIC_SOURCES, useExisting: PmMetricSourcesService },
    PmAgentImpactService,
    PmAgentImpactScheduler,
    // Weekly lessons: lessons/.
    PmLessonsSqlStore,
    PmAgentLessonsService,
    PmAgentLessonsScheduler,
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
