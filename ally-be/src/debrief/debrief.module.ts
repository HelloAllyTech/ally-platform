import { LlmModule } from '../llm/llm.module';
import { Module } from '@nestjs/common';
import { AiChatModule } from '../ai-chat/ai-chat.module';
import { LlmUsageModule } from '../analytics/llm-usage.module';
import { AwsModule } from '../aws/aws.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { NotificationModule } from '../notification/notification.module';
import { GuideCrisisResponse } from '../guide/entity/guide-crisis-response.entity';
import { GuideSignal } from '../guide/entity/guide-signal.entity';
import { GuideCrisisService } from '../guide/safety/guide-crisis.service';
import { ScenarioSessionChat } from '../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../learn/entity/scenario-session-chat-message.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentHarnessModule } from '../llm-agent/harness/agent-harness.module';
import { LearnModule } from '../learn/learn.module';
import { PromptModule } from '../prompt/prompt.module';
import { DebriefConsoleController } from './controller/debrief-console.controller';
import { DebriefLearnerController } from './controller/debrief-learner.controller';
import { DebriefFeedback } from './entity/debrief-feedback.entity';
import { DebriefRun } from './entity/debrief-run.entity';
import { DebriefAgentService } from './service/debrief-agent.service';
import { DebriefAiClient } from './service/debrief-ai.client';
import { DebriefConsoleService } from './service/debrief-console.service';
import { DebriefContextRepository } from './service/debrief-context.repository';
import { DebriefFeedbackService } from './service/debrief-feedback.service';
import { DebriefImproverService } from './service/debrief-improver.service';
import { DebriefKnowledgeService } from './service/debrief-knowledge.service';
import { DebriefNotifier } from './service/debrief-notifier.service';
import { DebriefPracticeService } from './service/debrief-practice.service';
import { DebriefAudioService } from './service/debrief-audio.service';
import { DebriefReplyService } from './service/debrief-reply.service';
import { DebriefRunJudgeService } from './service/debrief-run-judge.service';
import { DebriefRunnerService } from './service/debrief-runner.service';
import { DebriefTestSetsService } from './service/debrief-test-sets.service';

/**
 * The Debrief agent and its Improver (plan: ally-debriefs-plan.md). Runs on
 * the agent harness's releases and learning tables; its AI steps are
 * stateless calls into ally-ai.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DebriefRun,
      DebriefFeedback,
      // Ask Ally writes to the same thread today's debrief chat uses.
      ScenarioSessionChat,
      ScenarioSessionChatMessage,
      // The Guide's approved crisis copy, for a learner in crisis in Ask Ally.
      GuideCrisisResponse,
      GuideSignal,
    ]),
    AiChatModule,
    AwsModule,
    // The LLM catalog: a release's models must be active there.
    LlmModule,
    LlmUsageModule,
    // The guidance lookup's corpus, its audience rules and its retrieval log.
    KnowledgeBaseModule,
    // The bell and phone pushes: "your debrief is ready", "Ally updated it".
    NotificationModule,
    AgentHarnessModule,
    PromptModule,
    // "Practise this next" reads the learner's roleplays as their list does.
    LearnModule,
  ],
  controllers: [DebriefConsoleController, DebriefLearnerController],
  providers: [
    DebriefAiClient,
    DebriefContextRepository,
    DebriefRunnerService,
    DebriefRunJudgeService,
    DebriefAgentService,
    DebriefTestSetsService,
    DebriefImproverService,
    DebriefConsoleService,
    DebriefFeedbackService,
    DebriefPracticeService,
    DebriefReplyService,
    DebriefAudioService,
    DebriefKnowledgeService,
    DebriefNotifier,
    GuideCrisisService,
  ],
  exports: [DebriefAgentService],
})
export class DebriefModule {}
