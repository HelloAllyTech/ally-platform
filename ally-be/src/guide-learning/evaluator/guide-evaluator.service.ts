import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AgentEvaluation } from 'src/llm-agent/entity/agent-evaluation.entity';
import {
  AgentEvaluationSample,
  AgentEvaluationStatus,
  AgentReviewReason,
} from 'src/llm-agent/harness/enum/eval.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  ALLY_GUIDE_AGENT_KEY,
  evaluatorPolicy,
} from 'src/guide/release/guide-release.bundle';
import { redactText } from 'src/guide/safety/redaction';
import {
  CheckResult,
  failedChecks,
  hasSafetyFailure,
  runDeterministicChecks,
} from '../checks/deterministic-checks';
import { EVALUATION_RETENTION_DAYS } from '../constants/guide-learning.constants';
import { GuideEvalCaseService } from '../evals/guide-eval-case.service';
import { EVALUATOR_PROMPT_VERSION } from '../prompts/evaluator.prompt';
import { GuideReviewService } from '../review/guide-review.service';
import { GuideWindowService } from '../windows/guide-window.service';
import { ProductionWindow } from '../windows/production-window';
import { BudgetSpentError, GuideJudgeService } from './guide-judge.service';
import {
  Judgement,
  SAFETY_CRITERIA,
  disagreements,
  failedCriteria,
} from './rubric';
import { Arm, calibrationCount, planSample } from './sampling';

export const EVALUATOR_TASK = 'ally-guide-evaluator';

export interface NightReport {
  night: string;
  candidates: number;
  alreadyEvaluated: number;
  flagged: number;
  random: number;
  flaggedDropped: number;
  judged: number;
  checkedOnly: number;
  errors: number;
  safetyFlags: number;
  disagreements: number;
  reviewsQueued: number;
  casesProposed: number;
  costUsd: number;
  budgetUsd: number;
  budgetSpent: boolean;
  judgesSameFamily: boolean;
}

/** Yesterday as a UTC date (the job runs at 00:05 UTC). */
export function previousUtcDay(now = new Date()): string {
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

const redactJudgement = (judgement: Judgement | null) =>
  judgement
    ? {
        model: judgement.model,
        provider: judgement.provider,
        promptVersion: EVALUATOR_PROMPT_VERSION,
        criteria: Object.fromEntries(
          Object.entries(judgement.criteria).map(([id, c]) => [
            id,
            { verdict: c.verdict, reason: redactText(c.reason) },
          ]),
        ),
      }
    : null;

const checkRecord = (check: CheckResult) => ({
  id: check.id,
  severity: check.severity,
  applicable: check.applicable,
  passed: check.passed,
  detail: check.detail,
});

/**
 * The nightly evaluator (plans/ally-guide/plan.md §7.13): yesterday's Ally
 * turns are flagged cheaply, sampled (every flagged window up to 200, 5% of
 * the rest up to 300, split evenly between arms during a canary), checked
 * deterministically, graded by a critic and a verifier from a different
 * model family, and routed to the human review queue — every safety flag,
 * every disagreement, thumbs-down with a comment, and a 2% calibration
 * sample. Failed turns become proposed eval cases.
 *
 * The critic and verifier share a daily budget (`evaluator.dailyBudgetUsd`,
 * $25) with the red team; once it is spent, the rest of the night's windows
 * get the deterministic checks only and say so. Safety-flagged windows are
 * judged first, so the budget runs out on the least important ones.
 */
@Injectable()
export class GuideEvaluatorService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GuideEvaluatorService.name,
  );

  constructor(
    @InjectRepository(AgentEvaluation)
    private readonly evaluations: Repository<AgentEvaluation>,
    private readonly dataSource: DataSource,
    private readonly windows: GuideWindowService,
    private readonly judges: GuideJudgeService,
    private readonly reviews: GuideReviewService,
    private readonly cases: GuideEvalCaseService,
    private readonly releases: AgentReleaseService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', EVALUATOR_TASK, () =>
      this.runNight().then(() => undefined),
    );
  }

  async runNight(
    night: string = previousUtcDay(),
    random: () => number = Math.random,
  ): Promise<NightReport> {
    const bundle = await this.judges.evaluatorBundle();
    const policy = evaluatorPolicy(bundle.policy);
    const praiseEvery = bundle.policy?.praiseMaxPerTurns ?? 4;
    const judgesSameFamily = !this.judges.familiesDiffer(bundle);
    if (judgesSameFamily) {
      this.logger.warn(
        'The critic and verifier route to the same model family; disagreements will under-report',
      );
    }

    const all = await this.windows.loadNight(night, praiseEvery);
    const done = all.length
      ? await this.evaluations.find({
          where: { turnId: In(all.map((w) => w.turn.id)) },
          select: { turnId: true },
        })
      : [];
    const doneIds = new Set(done.map((row) => row.turnId));
    const fresh = all.filter((w) => !doneIds.has(w.turn.id));
    const canary = await this.releases.getCanary(ALLY_GUIDE_AGENT_KEY);
    const armOf = (w: ProductionWindow): Arm =>
      canary && w.turn.arm === 'canary' && w.turn.releaseId === canary.id
        ? 'canary'
        : 'ga';
    const byId = new Map(fresh.map((w) => [w.turn.id, w]));
    const plan = planSample(
      fresh.map((w) => ({
        turnId: w.turn.id,
        arm: armOf(w),
        flags: w.flags,
        safety: w.safety,
      })),
      { canaryActive: Boolean(canary), policy, random },
    );

    const report: NightReport = {
      night,
      candidates: all.length,
      alreadyEvaluated: doneIds.size,
      flagged: plan.flagged.length,
      random: plan.random.length,
      flaggedDropped: plan.flaggedDropped,
      judged: 0,
      checkedOnly: 0,
      errors: 0,
      safetyFlags: 0,
      disagreements: 0,
      reviewsQueued: 0,
      casesProposed: 0,
      costUsd: 0,
      budgetUsd: policy.dailyBudgetUsd,
      budgetSpent: false,
      judgesSameFamily,
    };

    const judged: Array<{ evaluationId: string; window: ProductionWindow }> =
      [];
    const failing: ProductionWindow[] = [];
    const sampled = [
      ...plan.flagged.map((c) => [c, AgentEvaluationSample.FLAGGED] as const),
      ...plan.random.map((c) => [c, AgentEvaluationSample.RANDOM] as const),
    ];
    for (const [candidate, sample] of sampled) {
      const base = byId.get(candidate.turnId)!;
      const window = await this.windows.enrich(base);
      const checks = runDeterministicChecks(window.window);
      let critic: Judgement | null = null;
      let verifier: Judgement | null = null;
      let status = AgentEvaluationStatus.CHECKED;
      let usd = 0;
      if (!report.budgetSpent) {
        try {
          await this.judges.assertBudget(policy.dailyBudgetUsd);
          const input = this.judgeInput(window);
          const ids = {
            threadId: window.turn.threadId,
            turnId: window.turn.id,
          };
          const first = await this.judges.judge(
            'evaluator_critic',
            input,
            bundle,
            ids,
          );
          critic = first.judgement;
          usd += first.usd;
          await this.judges.assertBudget(policy.dailyBudgetUsd);
          const second = await this.judges.judge(
            'evaluator_verifier',
            input,
            bundle,
            ids,
          );
          verifier = second.judgement;
          usd += second.usd;
          status = AgentEvaluationStatus.JUDGED;
        } catch (error) {
          if (error instanceof BudgetSpentError) {
            report.budgetSpent = true;
            this.logger.warn(`${error.message}; checks only from here`);
          } else {
            status = AgentEvaluationStatus.ERROR;
            report.errors++;
            this.logger.warn(
              `Judging turn ${window.turn.id} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
      const split = critic && verifier ? disagreements(critic, verifier) : [];
      const judgedSafetyFail = [
        ...failedCriteria(critic),
        ...failedCriteria(verifier),
      ].some((id) => SAFETY_CRITERIA.has(id));
      const safetyFlag =
        window.safety || hasSafetyFailure(checks) || judgedSafetyFail;
      const saved = await this.evaluations.save(
        this.evaluations.create({
          agentKey: ALLY_GUIDE_AGENT_KEY,
          turnId: window.turn.id,
          threadId: window.turn.threadId,
          releaseId: window.turn.releaseId,
          arm: candidate.arm,
          night,
          sample,
          status,
          flags: window.flags,
          deterministic: checks.filter((c) => c.applicable).map(checkRecord),
          critic: redactJudgement(critic),
          verifier: redactJudgement(verifier),
          disagreements: split,
          safetyFlag,
          costUsd: usd.toFixed(6),
          tenantId: window.turn.tenantId,
        }),
      );
      report.costUsd += usd;
      if (status === AgentEvaluationStatus.JUDGED) {
        report.judged++;
        judged.push({ evaluationId: saved.id, window });
      } else if (status === AgentEvaluationStatus.CHECKED) {
        report.checkedOnly++;
      }
      if (safetyFlag) {
        report.safetyFlags++;
        if (
          await this.reviews.enqueue({
            window,
            reason: AgentReviewReason.SAFETY_FLAG,
            evaluationId: saved.id,
          })
        ) {
          report.reviewsQueued++;
        }
      }
      if (split.length) {
        report.disagreements++;
        if (
          await this.reviews.enqueue({
            window,
            reason: AgentReviewReason.DISAGREEMENT,
            evaluationId: saved.id,
          })
        ) {
          report.reviewsQueued++;
        }
      }
      if (window.turn.status === 'failed' || failedChecks(checks).length > 0) {
        failing.push(window);
      }
    }

    report.reviewsQueued += await this.reviews.enqueueThumbsDown(night);

    // The calibration sample: judged windows a person would not otherwise
    // see, so κ is measured on ordinary turns, not only the hard ones.
    const ordinary = judged.filter(
      ({ window }) => !window.safety && !window.flags.length,
    );
    const pool = ordinary.length ? ordinary : judged;
    const count = calibrationCount(
      pool.length,
      policy.calibrationShare,
      random,
    );
    for (const { evaluationId, window } of pool
      .map((item) => ({ item, key: random() }))
      .sort((a, b) => a.key - b.key)
      .slice(0, count)
      .map(({ item }) => item)) {
      if (
        await this.reviews.enqueue({
          window,
          reason: AgentReviewReason.CALIBRATION,
          evaluationId,
        })
      ) {
        report.reviewsQueued++;
      }
    }

    report.casesProposed = await this.cases.proposeFromWindows(failing);
    await this.purgeExpired();
    report.costUsd = Number(report.costUsd.toFixed(6));
    this.logger.info(
      `Ally evaluator ${night}: ${report.candidates} candidates, ${report.judged} judged, ` +
        `${report.checkedOnly} checks only, ${report.safetyFlags} safety flags, ` +
        `${report.reviewsQueued} reviews queued, $${report.costUsd}`,
    );
    return report;
  }

  /** The redacted window the judges read. */
  private judgeInput(window: ProductionWindow) {
    return {
      situation: {
        mode: window.window.mode,
        channel: window.window.channel,
        budgetWords: window.window.budget?.maxWords ?? null,
        steerLevel: window.situation?.steerLevel ?? null,
        releaseWindowOpen: Boolean(window.window.releaseWindowOpen),
        quizOpen: Boolean(window.situation?.quizOpen),
        overlay: window.window.sentinel?.overlay ?? null,
      },
      recent: window.reviewable.recent,
      learnerText: window.reviewable.learnerText,
      reply: window.reviewable.reply,
      tools: window.window.toolCalls.map((call) => ({
        name: call.name,
        reason: (call.input?.reason as string | undefined) ?? null,
      })),
    };
  }

  /** Night-by-night numbers for the Console: counts and failure rates, no text. */
  async summary(days: number) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT "night"::text AS night,
              count(*) AS windows,
              count(*) FILTER (WHERE "status" = 'judged') AS judged,
              count(*) FILTER (WHERE "status" = 'checked') AS "checkedOnly",
              count(*) FILTER (WHERE "status" = 'error') AS errors,
              count(*) FILTER (WHERE "sample" = 'flagged') AS flagged,
              count(*) FILTER (WHERE "safetyFlag") AS "safetyFlags",
              count(*) FILTER (WHERE jsonb_array_length("disagreements") > 0) AS disagreements,
              COALESCE(sum("costUsd"), 0) AS "costUsd"
         FROM "agent_evaluations"
        WHERE "agentKey" = $1 AND "night" >= (now() at time zone 'utc')::date - $2::int
        GROUP BY 1 ORDER BY 1 DESC`,
      [ALLY_GUIDE_AGENT_KEY, days],
    );
    const checks: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT c->>'id' AS id,
              count(*) FILTER (WHERE (c->>'passed')::boolean = false) AS failed,
              count(*) AS applicable
         FROM "agent_evaluations" e, jsonb_array_elements(e."deterministic") c
        WHERE e."agentKey" = $1 AND e."night" >= (now() at time zone 'utc')::date - $2::int
        GROUP BY 1 ORDER BY 1`,
      [ALLY_GUIDE_AGENT_KEY, days],
    );
    const criteria: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT k AS id,
              count(*) FILTER (WHERE v->>'verdict' = 'fail') AS failed,
              count(*) FILTER (WHERE v->>'verdict' <> 'na') AS applicable
         FROM "agent_evaluations" e, jsonb_each(e."critic"->'criteria') AS x(k, v)
        WHERE e."agentKey" = $1 AND e."critic" IS NOT NULL
          AND e."night" >= (now() at time zone 'utc')::date - $2::int
        GROUP BY 1 ORDER BY 1`,
      [ALLY_GUIDE_AGENT_KEY, days],
    );
    const num = (v: unknown) => Number(v ?? 0);
    return {
      nights: rows.map((row) => ({
        night: row.night,
        windows: num(row.windows),
        judged: num(row.judged),
        checkedOnly: num(row.checkedOnly),
        errors: num(row.errors),
        flagged: num(row.flagged),
        safetyFlags: num(row.safetyFlags),
        disagreements: num(row.disagreements),
        costUsd: Number(num(row.costUsd).toFixed(4)),
      })),
      checks: checks.map((row) => ({
        id: row.id,
        failed: num(row.failed),
        applicable: num(row.applicable),
      })),
      criteria: criteria.map((row) => ({
        id: row.id,
        failed: num(row.failed),
        applicable: num(row.applicable),
      })),
      spentTodayUsd: Number((await this.judges.spentToday()).toFixed(4)),
    };
  }

  /** Plan §8.2: evaluations and closed reviews are kept 180 days. */
  async purgeExpired(): Promise<void> {
    try {
      await this.dataSource.query(
        `DELETE FROM "agent_reviews" WHERE "agentKey" = $1
            AND "status" IN ('done', 'dismissed')
            AND "createdAt" < now() - ($2::int * interval '1 day')`,
        [ALLY_GUIDE_AGENT_KEY, EVALUATION_RETENTION_DAYS],
      );
      await this.dataSource.query(
        `DELETE FROM "agent_evaluations" WHERE "agentKey" = $1
            AND "createdAt" < now() - ($2::int * interval '1 day')`,
        [ALLY_GUIDE_AGENT_KEY, EVALUATION_RETENTION_DAYS],
      );
    } catch (error) {
      this.logger.warn(
        `Evaluator retention purge failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Everything the learning loop holds about one conversation, for "Delete
   * my Ally conversations" and account deletion (plan §8.2): its
   * evaluations, reviews and the eval cases mined from it.
   */
  async forgetThread(threadId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM "agent_reviews" WHERE "threadId" = $1`,
      [threadId],
    );
    await this.dataSource.query(
      `DELETE FROM "agent_evaluations" WHERE "threadId" = $1`,
      [threadId],
    );
    await this.dataSource.query(
      `DELETE FROM "agent_eval_cases" WHERE "sourceThreadId" = $1`,
      [threadId],
    );
  }
}
