import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { AgentHarnessModule } from 'src/llm-agent/harness/agent-harness.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import { TrackModule } from 'src/track/track.module';
import { User } from 'src/user/entity/user.entity';
import { GuideToolExecutorService } from './capabilities/guide-tool-executor.service';
import { GuideConductorService } from './conductor/guide-conductor.service';
import { GuideAdminController } from './controller/guide-admin.controller';
import { GuideLearnerController } from './controller/guide-learner.controller';
import { GuidePublicController } from './controller/guide-public.controller';
import { GuideAppointment } from './entity/guide-appointment.entity';
import { GuideCard } from './entity/guide-card.entity';
import { GuideCrisisResponse } from './entity/guide-crisis-response.entity';
import { GuideLearnerMemory } from './entity/guide-learner-memory.entity';
import { GuideLearnerPrefs } from './entity/guide-learner-prefs.entity';
import { GuideMessage } from './entity/guide-message.entity';
import { GuideNotebookEntry } from './entity/guide-notebook-entry.entity';
import { GuideOrgProfile } from './entity/guide-org-profile.entity';
import { GuideSignal } from './entity/guide-signal.entity';
import { GuideThreadEvent } from './entity/guide-thread-event.entity';
import { GuideThread } from './entity/guide-thread.entity';
import { GuideTrigger } from './entity/guide-trigger.entity';
import { GuideTurnFeedback } from './entity/guide-turn-feedback.entity';
import { GuideVisitor } from './entity/guide-visitor.entity';
import { GuideBootstrapService } from './runtime/guide-bootstrap.service';
import { GuideEventBusService } from './runtime/guide-event-bus.service';
import { GuideModelService } from './runtime/guide-model.service';
import { GuideThreadService } from './runtime/guide-thread.service';
import { GuideTurnService } from './runtime/guide-turn.service';
import { GuideCrisisService } from './safety/guide-crisis.service';
import { GuideSentinelService } from './safety/guide-sentinel.service';
import { GuideSettingsService } from './settings/guide-settings.service';

/**
 * The Ally guide (plans/ally-guide/plan.md). A leaf module: it reads courses
 * and progress through TrackModule's exported services and nothing imports it
 * back, so it adds no edge to existing module cycles. Off by default — the
 * `ally_guide` kill switches gate every learner entry point.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuideVisitor,
      GuideThread,
      GuideMessage,
      GuideThreadEvent,
      GuideCard,
      GuideTrigger,
      GuideLearnerMemory,
      GuideLearnerPrefs,
      GuideNotebookEntry,
      GuideAppointment,
      GuideOrgProfile,
      GuideCrisisResponse,
      GuideSignal,
      GuideTurnFeedback,
      User,
    ]),
    AgentHarnessModule,
    LlmAgentModule,
    LlmUsageModule,
    TrackModule,
  ],
  controllers: [
    GuideLearnerController,
    GuidePublicController,
    GuideAdminController,
  ],
  providers: [
    GlobalSettingsRepository,
    GuideSettingsService,
    GuideEventBusService,
    GuideThreadService,
    GuideTurnService,
    GuideBootstrapService,
    GuideModelService,
    GuideSentinelService,
    GuideCrisisService,
    GuideConductorService,
    GuideToolExecutorService,
  ],
})
export class GuideModule {}
