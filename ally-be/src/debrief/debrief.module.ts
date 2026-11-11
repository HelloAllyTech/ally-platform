import { LlmModule } from '../llm/llm.module';
import { Module } from '@nestjs/common';
import { AiChatModule } from '../ai-chat/ai-chat.module';
import { AuditModule } from '../audit/audit.module';
import { LlmUsageModule } from '../analytics/llm-usage.module';
import { AwsModule } from '../aws/aws.module';
import { ContextLibraryModule } from '../context-library/context-library.module';
import { NotificationModule } from '../notification/notification.module';
import { GuideCrisisResponse } from '../guide/entity/guide-crisis-response.entity';
import { GuideSignal } from '../guide/entity/guide-signal.entity';
import { GuideCrisisService } from '../guide/safety/guide-crisis.service';
import { ScenarioSessionChat } from '../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../learn/entity/scenario-session-chat-message.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentHarnessModule } from '../llm-agent/harness/agent-harness.module';
import { LlmAgentModule } from '../llm-agent/llm-agent.module';
import { LearnModule } from '../learn/learn.module';
import { PromptModule } from '../prompt/prompt.module';
import { DebriefConsoleController } from './controller/debrief-console.controller';
import { DebriefLearnerController } from './controller/debrief-learner.controller';
import { DebriefGatewayController } from './controller/debrief-gateway.controller';
import { DebriefFeedback } from './entity/debrief-feedback.entity';
import { DebriefRun } from './entity/debrief-run.entity';
import { DebriefAgentService } from './service/debrief-agent.service';
import { AskAllyClient } from './service/ask-ally.client';
import { DebriefAiClient } from './service/debrief-ai.client';
import { DebriefConsoleService } from './service/debrief-console.service';
import { DebriefContextRepository } from './service/debrief-context.repository';
import { DebriefFeedbackService } from './service/debrief-feedback.service';
import { DebriefGatewayService } from './service/debrief-gateway.service';
import { DebriefGraphClient } from './service/debrief-graph.client';
import { DebriefRunTokenService } from './service/debrief-run-token.service';
import { DebriefPmAgentService } from './service/debrief-pm-agent.service';
import { DebriefNotifier } from './service/debrief-notifier.service';
import { DebriefPracticeService } from './service/debrief-practice.service';
import { DebriefAudioService } from './service/debrief-audio.service';
import { DebriefReplyService } from './service/debrief-reply.service';
import { DebriefReplyAgentService } from './service/debrief-reply-agent.service';
import { DebriefPublishService } from './service/debrief-publish.service';
import { DebriefSettingsService } from './service/debrief-settings.service';
import { DebriefBaselineService } from './service/debrief-baseline.service';
import { DebriefReportingService } from './service/debrief-reporting.service';
import { DebriefTrialsService } from './service/debrief-trials.service';
import { DebriefOwnerSettings } from './entity/debrief-owner-settings.entity';
import { DebriefProbeResult } from './entity/debrief-probe-result.entity';
import { DebriefLearnerEvent } from './entity/debrief-learner-event.entity';
import { DebriefLearnerEventsService } from './service/debrief-learner-events.service';
import { DebriefMetricsService } from './service/debrief-metrics.service';
import { DebriefConsoleAuditInterceptor } from './interceptor/debrief-console-audit.interceptor';
import { DebriefRunJudgeService } from './service/debrief-run-judge.service';
import { DebriefRunnerService } from './service/debrief-runner.service';
import { DebriefTestSetsService } from './service/debrief-test-sets.service';

/**
 * The Debrief agent and its PM agent (plan: ally-debriefs-plan.md). Runs on
 * the agent harness's releases and learning tables. A debrief run is a graph
 * in ally-ai (docs/debrief-harness/CONTRACT.md): `DebriefRunnerService`
 * prepares and applies, and the graph calls back the gateway tools at
 * `POST /api/v1/internal/debrief/tools/:name` (`DebriefGatewayController`),
 * authenticated by a per-run token, never a user's JWT.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DebriefRun,
      DebriefFeedback,
      DebriefOwnerSettings,
      DebriefProbeResult,
      DebriefLearnerEvent,
      // Ask Ally writes to the same thread today's debrief chat uses.
      ScenarioSessionChat,
      ScenarioSessionChatMessage,
      // The Guide's approved crisis copy, for a learner in crisis in Ask Ally.
      GuideCrisisResponse,
      GuideSignal,
    ]),
    AiChatModule,
    // v9 FR-38: every Debrief Console view writes an audit event.
    AuditModule,
    AwsModule,
    // The LLM catalog: a release's models must be active there.
    LlmModule,
    LlmUsageModule,
    // Debrief Guidance: the guidance lookup's collection, its audience rules and its log.
    ContextLibraryModule,
    // The bell and phone pushes: "your debrief is ready", "Ally updated it".
    NotificationModule,
    AgentHarnessModule,
    // Ask Ally's tool loop: the same tool-capable providers the Guide uses.
    LlmAgentModule,
    PromptModule,
    // "Practise this next" reads the learner's roleplays as their list does.
    LearnModule,
  ],
  controllers: [
    DebriefConsoleController,
    DebriefLearnerController,
    // The gateway tools ally-ai's debrief graph and Ask Ally call back (run token only).
    DebriefGatewayController,
  ],
  providers: [
    // Ask Ally's agent in ally-ai (CONTRACT.md §5).
    AskAllyClient,
    DebriefAiClient,
    DebriefContextRepository,
    DebriefGraphClient,
    DebriefRunTokenService,
    DebriefGatewayService,
    DebriefRunnerService,
    DebriefRunJudgeService,
    DebriefAgentService,
    DebriefTestSetsService,
    DebriefPmAgentService,
    DebriefConsoleService,
    DebriefFeedbackService,
    DebriefPracticeService,
    DebriefReplyService,
    DebriefReplyAgentService,
    DebriefPublishService,
    DebriefSettingsService,
    DebriefBaselineService,
    DebriefReportingService,
    DebriefTrialsService,
    DebriefLearnerEventsService,
    DebriefMetricsService,
    DebriefConsoleAuditInterceptor,
    DebriefAudioService,
    DebriefNotifier,
    GuideCrisisService,
  ],
  exports: [DebriefAgentService],
})
export class DebriefModule {}
