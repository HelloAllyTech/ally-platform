import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuideModule } from 'src/guide/guide.module';
import { AgentEvalCase } from 'src/llm-agent/entity/agent-eval-case.entity';
import { AgentEvalResult } from 'src/llm-agent/entity/agent-eval-result.entity';
import { AgentEvalRun } from 'src/llm-agent/entity/agent-eval-run.entity';
import { AgentEvalSuite } from 'src/llm-agent/entity/agent-eval-suite.entity';
import { AgentEvaluation } from 'src/llm-agent/entity/agent-evaluation.entity';
import { AgentReview } from 'src/llm-agent/entity/agent-review.entity';
import { AgentDelegation } from 'src/llm-agent/entity/agent-delegation.entity';
import { AgentLesson } from 'src/llm-agent/entity/agent-lesson.entity';
import { AgentLessonAudit } from 'src/llm-agent/entity/agent-lesson-audit.entity';
import { AgentShadowReport } from 'src/llm-agent/entity/agent-shadow-report.entity';
import { AgentSyntheticRun } from 'src/llm-agent/entity/agent-synthetic-run.entity';
import { AgentHarnessModule } from 'src/llm-agent/harness/agent-harness.module';
import { GuideLearningAdminController } from './controller/guide-learning-admin.controller';
import { GuideEvalCaseService } from './evals/guide-eval-case.service';
import { GuideEvalRunService } from './evals/guide-eval-run.service';
import { GuideRedTeamService } from './evals/guide-red-team.service';
import { GuideEvaluatorService } from './evaluator/guide-evaluator.service';
import { GuideJudgeService } from './evaluator/guide-judge.service';
import { GuideReviewService } from './review/guide-review.service';
import { GuideWindowService } from './windows/guide-window.service';
import { GuideCuratorService } from './curator/guide-curator.service';
import { GuideLearningAuditService } from './curator/guide-learning-audit.service';
import { GuideCanaryMonitorService } from './pipeline/guide-canary-monitor.service';
import { GuideDelegationService } from './pipeline/guide-delegation.service';
import { GuidePipelineService } from './pipeline/guide-pipeline.service';
import { GuideShadowService } from './shadow/guide-shadow.service';
import { GuideSyntheticService } from './synthetic/guide-synthetic.service';

/**
 * The Ally guide's learning loop (plans/ally-guide/plan.md §7.12–§7.13,
 * §10.1): the nightly evaluator, the human review queue and κ, eval cases,
 * the red team and eval runs; the curator, shadow replay, the canary
 * monitor, progressive delegation and the pipeline that joins them; and
 * nightly synthetic monitoring. Offline only — nothing here runs on a
 * learner's turn.
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
      AgentLesson,
      AgentLessonAudit,
      AgentDelegation,
      AgentShadowReport,
      AgentSyntheticRun,
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
    GuideLearningAuditService,
    GuideCuratorService,
    GuideShadowService,
    GuideDelegationService,
    GuideCanaryMonitorService,
    GuidePipelineService,
    GuideSyntheticService,
  ],
  exports: [GuideEvaluatorService, GuideReviewService, GuideEvalRunService],
})
export class GuideLearningModule {}
