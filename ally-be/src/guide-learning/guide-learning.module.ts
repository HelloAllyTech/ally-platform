import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuideModule } from 'src/guide/guide.module';
import { AgentEvalCase } from 'src/llm-agent/entity/agent-eval-case.entity';
import { AgentEvalResult } from 'src/llm-agent/entity/agent-eval-result.entity';
import { AgentEvalRun } from 'src/llm-agent/entity/agent-eval-run.entity';
import { AgentEvalSuite } from 'src/llm-agent/entity/agent-eval-suite.entity';
import { AgentEvaluation } from 'src/llm-agent/entity/agent-evaluation.entity';
import { AgentReview } from 'src/llm-agent/entity/agent-review.entity';
import { AgentHarnessModule } from 'src/llm-agent/harness/agent-harness.module';
import { GuideLearningAdminController } from './controller/guide-learning-admin.controller';
import { GuideEvalCaseService } from './evals/guide-eval-case.service';
import { GuideEvalRunService } from './evals/guide-eval-run.service';
import { GuideRedTeamService } from './evals/guide-red-team.service';
import { GuideEvaluatorService } from './evaluator/guide-evaluator.service';
import { GuideJudgeService } from './evaluator/guide-judge.service';
import { GuideReviewService } from './review/guide-review.service';
import { GuideWindowService } from './windows/guide-window.service';

/**
 * The Ally guide's learning loop (plans/ally-guide/plan.md §7.13, §10.1):
 * the nightly evaluator, the human review queue and κ, eval cases, the red
 * team and eval runs. Offline only — nothing here runs on a learner's turn.
 *
 * A leaf over GuideModule: it replays through the guide's Playground and
 * calls models through the guide's one model path, and nothing imports it
 * back, so it adds no edge to a cycle. Harness tables are `agent_*` (generic);
 * what is Ally-specific — the rubric, the checks, the categories — lives here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentEvalSuite,
      AgentEvalCase,
      AgentEvalRun,
      AgentEvalResult,
      AgentEvaluation,
      AgentReview,
    ]),
    AgentHarnessModule,
    GuideModule,
  ],
  controllers: [GuideLearningAdminController],
  providers: [
    GuideWindowService,
    GuideJudgeService,
    GuideReviewService,
    GuideEvalCaseService,
    GuideEvalRunService,
    GuideRedTeamService,
    GuideEvaluatorService,
  ],
  exports: [GuideEvaluatorService, GuideReviewService, GuideEvalRunService],
})
export class GuideLearningModule {}
