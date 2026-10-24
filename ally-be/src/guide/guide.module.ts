import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { AgentHarnessModule } from 'src/llm-agent/harness/agent-harness.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import { TrackModule } from 'src/track/track.module';
import { Track } from 'src/track/entity/track.entity';
import { User } from 'src/user/entity/user.entity';
import { GuideToolExecutorService } from './capabilities/guide-tool-executor.service';
import { GuideTutorService } from './capabilities/specialists/guide-tutor.service';
import { GuideCourseContentService } from './content/guide-course-content.service';
import { GuideLearnerDataService } from './learner/guide-learner-data.service';
import { GuideConductorService } from './conductor/guide-conductor.service';
import { GuideAdminService } from './admin/guide-admin.service';
import { GuideAdminController } from './controller/guide-admin.controller';
import { GuideLibraryAdminController } from './controller/guide-library-admin.controller';
import { GuideLibraryService } from './knowledge/guide-library.service';
import { KnowledgeBaseModule } from 'src/knowledge-base/knowledge-base.module';
import { GuideLearnerController } from './controller/guide-learner.controller';
import { GuidePublicController } from './controller/guide-public.controller';
import { GuideVoiceController } from './controller/guide-voice.controller';
import { GuideVoiceService } from './voice/guide-voice.service';
import { LiveKitModule } from 'src/livekit/livekit.module';
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
import { GuideAdviceLine } from './entity/guide-advice-line.entity';
import { GuidePracticeHistoryService } from './learner/guide-practice-history.service';
import { GuidePeerService } from './peer/guide-peer.service';
import { GuideVisitor } from './entity/guide-visitor.entity';
import { GuideBootstrapService } from './runtime/guide-bootstrap.service';
import { GuideCardService } from './runtime/guide-card.service';
import { GuideEventBusService } from './runtime/guide-event-bus.service';
import { GuideProgressListener } from './runtime/guide-progress.listener';
import { GuideViewService } from './runtime/guide-view.service';
import { GuideModelService } from './runtime/guide-model.service';
import { GuideThreadService } from './runtime/guide-thread.service';
import { GuideTurnService } from './runtime/guide-turn.service';
import { GuideCrisisService } from './safety/guide-crisis.service';
import { GuideSentinelService } from './safety/guide-sentinel.service';
import { GuideSettingsService } from './settings/guide-settings.service';
import { GuideVisitorService } from './visitor/guide-visitor.service';
import { GuideBaselineService } from './measure/guide-baseline.service';
import { GuideAlertService } from './measure/guide-alert.service';
import { GuideOutreachService } from './outreach/guide-outreach.service';
import { GuideAssessorService } from './capabilities/specialists/guide-assessor.service';
import { GuideCoachService } from './capabilities/specialists/guide-coach.service';
import { GuideSideQuestService } from './runtime/guide-side-quest.service';
import { GuideOutreach } from './entity/guide-outreach.entity';
import { AwsModule } from 'src/aws/aws.module';
import { NotificationModule } from 'src/notification/notification.module';
import { GuideAlert } from './entity/guide-alert.entity';
import { GuidePlaygroundService } from './admin/guide-playground.service';
import { GuideBaselineSnapshot } from './entity/guide-baseline-snapshot.entity';

/**
 * The Ally guide (plans/ally-guide/plan.md). A leaf module: it reads courses
 * and progress through TrackModule's exported services and nothing imports it
 * back, so it adds no edge to existing module cycles. Off by default — the
 * `ally_guide` kill switches gate every learner entry point.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuideOutreach,
      GuideAlert,
      GuideBaselineSnapshot,
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
      GuideAdviceLine,
      User,
      Track,
    ]),
    AgentHarnessModule,
    LlmAgentModule,
    LlmUsageModule,
    TrackModule,
    LiveKitModule,
    AwsModule,
    NotificationModule,
    // Ally's library (GuideLibraryService, GuideLibraryAdminController). The KB module
    // imports only aws/ai, so this adds no cycle.
    KnowledgeBaseModule,
  ],
  controllers: [
    GuideLearnerController,
    GuidePublicController,
    GuideAdminController,
    GuideLibraryAdminController,
    GuideVoiceController,
  ],
  providers: [
    GuideLibraryService,
    GuidePracticeHistoryService,
    GuidePeerService,
    GuideAssessorService,
    GuideCoachService,
    GuideSideQuestService,
    GuideOutreachService,
    GuideAlertService,
    GuideBaselineService,
    GuidePlaygroundService,
    GuideVisitorService,
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
    GuideViewService,
    GuideCardService,
    GuideProgressListener,
    GuideAdminService,
    GuideTutorService,
    GuideCourseContentService,
    GuideLearnerDataService,
    GuideVoiceService,
  ],
})
export class GuideModule {}
