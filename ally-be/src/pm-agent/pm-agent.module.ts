import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { BuilderPullRequest } from 'src/builder/entity/builder-pull-request.entity';
import { NotificationModule } from 'src/notification/notification.module';
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
import {
  NoopPmAgentRunTrigger,
  PM_AGENT_RUN_TRIGGER,
} from './service/pm-agent-run-trigger';
import { PmAgentSchedulerService } from './service/pm-agent-scheduler.service';
import { PmAgentSettingsService } from './service/pm-agent-settings.service';
import { PmAgentStateService } from './service/pm-agent-state.service';

/**
 * PM Agent (docs/pm-agent.md): the admin AI product manager. This module is the
 * deterministic half — state, queue, budget read-out, the card state machine, the accept
 * outbox and Builder wiring, the realtime feed. The generation pipeline (lanes, critic,
 * ranker, daily scheduler) plugs in by providing PM_AGENT_RUN_TRIGGER and writing cards
 * through the repositories exported here.
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
    { provide: PM_AGENT_RUN_TRIGGER, useClass: NoopPmAgentRunTrigger },
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
