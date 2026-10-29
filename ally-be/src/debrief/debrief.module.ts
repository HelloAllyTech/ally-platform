import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentHarnessModule } from '../llm-agent/harness/agent-harness.module';
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
    TypeOrmModule.forFeature([DebriefRun, DebriefFeedback]),
    AgentHarnessModule,
    PromptModule,
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
  ],
  exports: [DebriefAgentService],
})
export class DebriefModule {}
